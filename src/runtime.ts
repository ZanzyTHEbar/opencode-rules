import {
  formatMergedRulesForPrompt,
  mergeRuleSelections,
  type ActiveRule,
} from './rule-selection.js';
import {
  readMatchingRules,
  type MatchedRule,
  type RuleFilterContext,
} from './rule-filter.js';
import { extractFilePathsFromMessages } from './message-paths.js';
import { extractDirFromGlob } from './message-paths.js';
import { type DiscoveredRule } from './rule-discovery.js';
import {
  extractSessionID,
  normalizeContextPath,
  sanitizePathForContext,
  toExtractableMessages,
  type MessageWithInfo,
} from './message-context.js';
import { extractConnectedMcpCapabilityIDs } from './mcp-tools.js';
import { createDebugLog, type DebugLog } from './debug.js';
import type { SessionStore } from './session-store.js';
import {
  buildFilterContext,
  type BuildFilterContextOptions,
} from './runtime-context.js';
import {
  handleChatMessage,
  type ChatMessageInput,
  type ChatMessageOutput,
} from './runtime-chat.js';
import {
  writeActiveRulesState,
  type ActiveRuleRecord,
} from './active-rules-state.js';
import { parseInlineRuleReferences } from './manual-rule-refs.js';
import { RuleRegistry } from './rule-registry.js';
import {
  formatActiveRules,
  formatOrulesHelp,
  formatResolutionProblems,
  formatRuleDetails,
  formatRuleList,
  parseOrulesCommand,
} from './orules-command.js';
import {
  buildRuleCompletionSuffix,
  detectRuleCompletionRequest,
} from './text-completion.js';

interface MessagesTransformOutput {
  messages: MessageWithInfo[];
}

interface SystemTransformInput {
  sessionID?: string;
}

interface SystemTransformOutput {
  system?: string | string[];
}

interface CommandExecuteInput {
  command?: string;
  sessionID?: string;
  arguments?: string;
}

interface CommandExecuteOutput {
  parts?: Array<{ type?: string; text?: string; ignored?: boolean }>;
}

interface ConfigCommandDefinition {
  template: string;
  description?: string;
  agent?: string;
  model?: string;
  subtask?: boolean;
}

interface ConfigHookInput {
  command?: Record<string, ConfigCommandDefinition>;
}

interface TextCompleteInput {
  sessionID?: string;
  messageID?: string;
  partID?: string;
}

interface TextCompleteOutput {
  text: string;
}

interface OpenCodeRulesRuntimeOptions {
  client: unknown;
  directory: string;
  projectDirectory: string;
  ruleFiles: DiscoveredRule[];
  ruleRegistry: RuleRegistry;
  sessionStore: SessionStore;
  debugLog?: DebugLog;
  now?: () => number;
}

export class OpenCodeRulesRuntime {
  private readonly processedInlineParts = new WeakSet<object>();
  private client: unknown;
  private directory: string;
  private projectDirectory: string;
  private ruleFiles: DiscoveredRule[];
  private ruleRegistry: RuleRegistry;
  private sessionStore: SessionStore;
  private debugLog: DebugLog;
  private now: () => number;

  constructor(opts: OpenCodeRulesRuntimeOptions) {
    this.client = opts.client;
    this.directory = opts.directory;
    this.projectDirectory = opts.projectDirectory;
    this.ruleFiles = opts.ruleFiles;
    this.ruleRegistry = opts.ruleRegistry;
    this.sessionStore = opts.sessionStore;
    this.debugLog = opts.debugLog ?? createDebugLog();
    this.now = opts.now ?? (() => Date.now());
  }

  createHooks(): Record<string, unknown> {
    return {
      config: this.onConfig.bind(this),
      'command.execute.before': this.onCommandExecuteBefore.bind(this),
      'tool.execute.before': this.onToolExecuteBefore.bind(this),
      'experimental.chat.messages.transform':
        this.onMessagesTransform.bind(this),
      'chat.message': this.onChatMessage.bind(this),
      'experimental.chat.system.transform': this.onSystemTransform.bind(this),
      'experimental.session.compacting': this.onSessionCompacting.bind(this),
      'experimental.text.complete': this.onTextComplete.bind(this),
    };
  }

  private async onConfig(input: ConfigHookInput): Promise<void> {
    input.command ??= {};
    input.command['orules'] = {
      template: '',
      description: 'Manage and inspect OpenCode rules',
    };
  }

  private async onToolExecuteBefore(
    input: { tool?: string; sessionID?: string; callID?: string },
    output: { args?: Record<string, unknown> }
  ): Promise<void> {
    const sessionID = input?.sessionID;
    const toolName = input?.tool;
    const args = output?.args;

    if (!sessionID || !toolName || !args) {
      return;
    }

    let filePath: string | undefined;

    if (['read', 'edit', 'write'].includes(toolName)) {
      const arg = args.filePath;
      if (typeof arg === 'string' && arg.length > 0) {
        filePath = arg;
      }
    } else if (['glob', 'grep'].includes(toolName)) {
      const pathArg = args.path;
      const patternArg = args.pattern;
      if (typeof pathArg === 'string' && pathArg.length > 0) {
        filePath = pathArg;
      } else if (toolName === 'glob' && typeof patternArg === 'string') {
        filePath = extractDirFromGlob(patternArg) ?? undefined;
      }
    } else if (toolName === 'bash') {
      const arg = args.workdir;
      if (typeof arg === 'string' && arg.length > 0) {
        filePath = arg;
      }
    }

    if (filePath) {
      const normalized = normalizeContextPath(filePath, this.projectDirectory);
      this.sessionStore.upsert(sessionID, state => {
        state.contextPaths.add(normalized);
      });

      this.debugLog(
        `Recorded context path from tool ${toolName}: ${normalized}`
      );
    }
  }

  private async onMessagesTransform(
    _input: Record<string, never>,
    output: MessagesTransformOutput
  ): Promise<MessagesTransformOutput> {
    const sessionID = extractSessionID(output.messages);
    if (!sessionID) {
      this.debugLog('No sessionID found in messages');
      return output;
    }

    const existingState = this.sessionStore.get(sessionID);

    if (!existingState?.seededFromHistory) {
      const contextPaths = extractFilePathsFromMessages(
        toExtractableMessages(output.messages)
      );

      this.sessionStore.upsert(sessionID, state => {
        for (const p of contextPaths) {
          state.contextPaths.add(
            normalizeContextPath(p, this.projectDirectory)
          );
        }
        state.seededFromHistory = true;
        state.seedCount = (state.seedCount ?? 0) + 1;
      });

      if (contextPaths.length > 0) {
        this.debugLog(
          `Seeded ${contextPaths.length} context path(s) for session ${sessionID}: ${contextPaths
            .slice(0, 5)
            .join(', ')}${contextPaths.length > 5 ? '...' : ''}`
        );
      }
    } else {
      this.debugLog(`Session ${sessionID} already seeded, skipping rescan`);
    }

    const latestUserMessage = this.findLatestUserTextMessage(output.messages);
    if (latestUserMessage) {
      const { messageID, text } = latestUserMessage;
      const parsed = parseInlineRuleReferences(text);
      const shouldUpdateText = parsed.strippedText !== text;
      const shouldProcessInlineRefs =
        parsed.references.length > 0 &&
        (messageID
          ? existingState?.lastProcessedInlineMessageID !== messageID
          : !this.processedInlineParts.has(latestUserMessage.part));
      const shouldClearStaleInlineRefs = Boolean(
        existingState &&
        existingState.pendingInlineRuleIDs.size > 0 &&
        parsed.references.length === 0 &&
        (messageID
          ? existingState.lastProcessedInlineMessageID !== messageID
          : existingState.lastUserPrompt !== parsed.strippedText)
      );

      if (
        shouldUpdateText ||
        shouldProcessInlineRefs ||
        shouldClearStaleInlineRefs ||
        existingState?.lastUserPrompt !== parsed.strippedText
      ) {
        this.sessionStore.upsert(sessionID, state => {
          state.lastUserPrompt = parsed.strippedText;

          if (shouldClearStaleInlineRefs) {
            state.pendingInlineRuleIDs.clear();
          }

          if (shouldProcessInlineRefs) {
            for (const reference of parsed.references) {
              state.pendingInlineRuleIDs.add(reference);
            }
            if (messageID) {
              state.lastProcessedInlineMessageID = messageID;
            } else {
              this.processedInlineParts.add(latestUserMessage.part);
            }
            state.rulesInjected = false;
          }
        });
      }

      if (shouldUpdateText) {
        latestUserMessage.part.text = parsed.strippedText;
      }
    }

    return output;
  }

  private async onChatMessage(
    input: ChatMessageInput,
    output: ChatMessageOutput
  ): Promise<void> {
    handleChatMessage(input, output, this.sessionStore, this.debugLog);
  }

  private async onSystemTransform(
    hookInput: SystemTransformInput,
    output: SystemTransformOutput | null
  ): Promise<SystemTransformOutput> {
    const sessionID = hookInput?.sessionID;
    const sessionState = sessionID
      ? this.sessionStore.get(sessionID)
      : undefined;

    if (sessionID) {
      const skip = this.sessionStore.shouldSkipInjection(
        sessionID,
        this.now(),
        30_000
      );
      if (skip) {
        this.debugLog(
          `Session ${sessionID} is compacting - skipping rule injection`
        );
        return output ?? {};
      }
    }

    if (sessionState?.rulesInjected) {
      this.debugLog(
        `Session ${sessionID} already has rules injected - skipping to prevent loop`
      );
      return output ?? {};
    }

    const contextPaths = sessionState
      ? Array.from(sessionState.contextPaths).sort((a, b) => a.localeCompare(b))
      : [];
    const userPrompt = sessionState?.lastUserPrompt;

    const availableToolIDs = await this.queryAvailableToolIDs();

    const filterContextOpts: BuildFilterContextOptions = {
      contextFilePaths: contextPaths,
      userPrompt,
      availableToolIDs,
      modelID: sessionState?.lastModelID,
      agentType: sessionState?.lastAgentType,
    };

    const filterContext: RuleFilterContext = await buildFilterContext(
      filterContextOpts,
      this.projectDirectory,
      this.debugLog
    );

    const automaticRules = await readMatchingRules(
      this.ruleFiles,
      filterContext
    );

    const manualPinnedRules = sessionState
      ? await this.resolveManualRuleIDs(
          Array.from(sessionState.manualPinnedRuleIDs)
        )
      : [];
    const inlineRules = sessionState
      ? await this.resolveManualRuleIDs(
          Array.from(sessionState.pendingInlineRuleIDs)
        )
      : [];

    const mergedRules = mergeRuleSelections([
      { source: 'automatic', rules: automaticRules },
      { source: 'manual-pinned', rules: manualPinnedRules },
      { source: 'manual-inline', rules: inlineRules },
    ]);

    const formattedRules = formatMergedRulesForPrompt(mergedRules);
    const activeRuleRecords = mergedRules.map(rule =>
      this.toActiveRuleRecord(rule)
    );

    if (sessionID) {
      writeActiveRulesState(sessionID, activeRuleRecords);
    }

    if (!formattedRules) {
      this.debugLog('No applicable rules for current context');
      if (sessionID) {
        this.sessionStore.upsert(sessionID, state => {
          state.pendingInlineRuleIDs.clear();
        });
      }
      return output ?? {};
    }

    this.debugLog('Injecting rules into system prompt');

    if (!output) {
      if (sessionID) {
        this.sessionStore.upsert(sessionID, state => {
          state.pendingInlineRuleIDs.clear();
          state.rulesInjected = true;
          state.lastInjectedAt = this.now();
        });
      }
      return { system: formattedRules };
    }

    if (Array.isArray(output.system)) {
      output.system.push(formattedRules);
    } else {
      output.system = output.system
        ? `${output.system}\n\n${formattedRules}`
        : formattedRules;
    }

    if (sessionID) {
      this.sessionStore.upsert(sessionID, state => {
        state.pendingInlineRuleIDs.clear();
        state.rulesInjected = true;
        state.lastInjectedAt = this.now();
      });
    }

    return output;
  }

  private async onCommandExecuteBefore(
    input: CommandExecuteInput,
    output: CommandExecuteOutput
  ): Promise<void> {
    if (input.command !== 'orules' || !input.sessionID) {
      return;
    }

    const sessionID = input.sessionID;
    const sessionState = this.sessionStore.get(sessionID);
    const parsed = parseOrulesCommand(input.arguments ?? '');
    const activeRules = await this.computeCurrentActiveRules(sessionID);
    let responseText = formatOrulesHelp();

    if (parsed.subcommand === 'help') {
      responseText = formatOrulesHelp();
    } else if (parsed.subcommand === 'list') {
      const query = parsed.args.join(' ').trim();
      const matches = await this.ruleRegistry.search(query || undefined);
      responseText = formatRuleList(matches, {
        activeRuleIDs: new Set(activeRules.map(rule => rule.ruleId)),
        pinnedRuleIDs: new Set(
          sessionState ? Array.from(sessionState.manualPinnedRuleIDs) : []
        ),
        ...(query ? { query } : {}),
      });
    } else if (parsed.subcommand === 'active') {
      responseText = formatActiveRules(activeRules);
    } else if (parsed.subcommand === 'show') {
      const target = parsed.args[0];
      if (!target) {
        responseText = 'Usage: /orules show <rule-id>';
      } else {
        const resolved = await this.ruleRegistry.resolve(target);
        if (resolved.entry) {
          const activeRule = activeRules.find(
            rule => rule.ruleId === resolved.entry!.ruleId
          );
          responseText = formatRuleDetails(resolved.entry, activeRule);
        } else {
          responseText =
            formatResolutionProblems(
              resolved.reason === 'missing' ? [target] : [],
              resolved.reason === 'ambiguous' && resolved.matches
                ? [{ query: target, matches: resolved.matches }]
                : []
            ) ?? `Rule not found: ${target}`;
        }
      }
    } else if (parsed.subcommand === 'activate') {
      const resolution = await this.ruleRegistry.resolveMany(parsed.args);
      if (resolution.resolved.length > 0) {
        this.sessionStore.upsert(sessionID, state => {
          for (const entry of resolution.resolved) {
            state.manualPinnedRuleIDs.add(entry.ruleId);
          }
          state.rulesInjected = false;
        });
      }

      const lines = [
        resolution.resolved.length > 0
          ? `Pinned ${resolution.resolved.length} rule(s).`
          : 'No rules were pinned.',
      ];
      const problems = formatResolutionProblems(
        resolution.missing,
        resolution.ambiguous
      );
      if (resolution.resolved.length > 0) {
        lines.push(...resolution.resolved.map(rule => `- ${rule.ruleId}`));
      }
      if (problems) {
        lines.push('', problems);
      }
      responseText = lines.join('\n');
    } else if (parsed.subcommand === 'deactivate') {
      if (parsed.args.length === 0) {
        responseText = 'Usage: /orules deactivate <rule-id> [rule-id...]';
      } else {
        const resolution = await this.ruleRegistry.resolveMany(parsed.args);
        const removed: string[] = [];
        this.sessionStore.upsert(sessionID, state => {
          for (const entry of resolution.resolved) {
            if (state.manualPinnedRuleIDs.delete(entry.ruleId)) {
              removed.push(entry.ruleId);
            }
          }
          state.rulesInjected = false;
        });

        const problems = formatResolutionProblems(
          resolution.missing,
          resolution.ambiguous
        );
        responseText = [
          removed.length > 0
            ? `Unpinned ${removed.length} rule(s).`
            : 'No pinned rules were removed.',
          ...removed.map(ruleId => `- ${ruleId}`),
          ...(problems ? ['', problems] : []),
        ].join('\n');
      }
    } else if (parsed.subcommand === 'clear') {
      const cleared = sessionState?.manualPinnedRuleIDs.size ?? 0;
      this.sessionStore.upsert(sessionID, state => {
        state.manualPinnedRuleIDs.clear();
        state.rulesInjected = false;
      });
      responseText = `Cleared ${cleared} pinned rule(s).`;
    } else {
      responseText = `Unknown /orules subcommand: ${parsed.subcommand}\n\n${formatOrulesHelp()}`;
    }

    await this.sendIgnoredSessionMessage(sessionID, responseText);

    output.parts = output.parts ?? [];
    throw new Error('__ORULES_COMMAND_HANDLED__');
  }

  private async onTextComplete(
    input: TextCompleteInput,
    output: TextCompleteOutput
  ): Promise<void> {
    if (!input.sessionID || !input.messageID || !input.partID) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = this.client as any;
    const result = await client.session?.message?.({
      path: { id: input.sessionID, messageID: input.messageID },
    });
    const parts = result?.data?.parts;
    if (!Array.isArray(parts)) {
      return;
    }

    const currentPart = parts.find(
      (part: { id?: string; type?: string; text?: string }) =>
        part.id === input.partID &&
        (part.type === 'text' || part.type === undefined)
    );
    if (!currentPart || typeof currentPart.text !== 'string') {
      return;
    }

    const request = detectRuleCompletionRequest(currentPart.text);
    if (!request) {
      return;
    }

    const matches = await this.ruleRegistry.completePrefix(request.prefix);
    if (matches.length !== 1) {
      return;
    }

    const suffix = buildRuleCompletionSuffix(
      request.prefix,
      matches[0],
      request.suffix
    );
    if (suffix) {
      output.text = suffix;
    }
  }

  private findLatestUserTextMessage(messages: MessageWithInfo[]): {
    messageID?: string;
    part: { text?: string; ignored?: boolean };
    text: string;
  } | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      const role = message.role ?? message.info?.role;
      if (role !== 'user' || !Array.isArray(message.parts)) {
        continue;
      }

      for (let j = message.parts.length - 1; j >= 0; j--) {
        const part = message.parts[j];
        if (part.ignored || part.synthetic) continue;
        if (
          (part.type === 'text' || part.type === undefined) &&
          typeof part.text === 'string'
        ) {
          return {
            part,
            text: part.text,
            ...(message.info?.id ? { messageID: message.info.id } : {}),
          };
        }
      }
    }

    return null;
  }

  private async resolveManualRuleIDs(
    references: string[]
  ): Promise<MatchedRule[]> {
    if (references.length === 0) {
      return [];
    }

    const resolution = await this.ruleRegistry.resolveMany(references);
    return resolution.resolved.map(entry => ({
      filePath: entry.filePath,
      relativePath: entry.relativePath,
      ruleId: entry.ruleId,
      content: entry.content,
      metadata: entry.metadata,
    }));
  }

  private toActiveRuleRecord(rule: ActiveRule): ActiveRuleRecord {
    return {
      ruleId: rule.ruleId,
      filePath: rule.filePath,
      relativePath: rule.relativePath,
      sources: [...rule.sources],
    };
  }

  private async computeCurrentActiveRules(
    sessionID: string
  ): Promise<ActiveRule[]> {
    const sessionState = this.sessionStore.get(sessionID);
    if (!sessionState) {
      return [];
    }

    const availableToolIDs = await this.queryAvailableToolIDs();
    const filterContextOpts: BuildFilterContextOptions = {
      contextFilePaths: Array.from(sessionState.contextPaths).sort((a, b) =>
        a.localeCompare(b)
      ),
      userPrompt: sessionState.lastUserPrompt,
      availableToolIDs,
      modelID: sessionState.lastModelID,
      agentType: sessionState.lastAgentType,
    };

    const filterContext = await buildFilterContext(
      filterContextOpts,
      this.projectDirectory,
      this.debugLog
    );

    const automaticRules = await readMatchingRules(
      this.ruleFiles,
      filterContext
    );
    const manualPinnedRules = await this.resolveManualRuleIDs(
      Array.from(sessionState.manualPinnedRuleIDs)
    );
    const inlineRules = await this.resolveManualRuleIDs(
      Array.from(sessionState.pendingInlineRuleIDs)
    );

    return mergeRuleSelections([
      { source: 'automatic', rules: automaticRules },
      { source: 'manual-pinned', rules: manualPinnedRules },
      { source: 'manual-inline', rules: inlineRules },
    ]);
  }

  private async sendIgnoredSessionMessage(
    sessionID: string,
    text: string
  ): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = this.client as any;
    if (!client.session?.prompt) {
      return;
    }

    await client.session.prompt({
      path: { id: sessionID },
      body: {
        noReply: true,
        parts: [
          {
            type: 'text',
            text,
            ignored: true,
          },
        ],
      },
    });
  }

  private async queryAvailableToolIDs(): Promise<string[]> {
    const ids = new Set<string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = this.client as any;
    const query = { directory: this.directory };

    const [toolResult, mcpResult] = await Promise.allSettled([
      client.tool?.ids?.({ query }),
      client.mcp?.status?.({ query }),
    ]);

    if (
      toolResult.status === 'fulfilled' &&
      Array.isArray(toolResult.value?.data)
    ) {
      for (const id of toolResult.value.data) {
        ids.add(id);
      }
      this.debugLog(
        `Built-in tools: ${toolResult.value.data.slice(0, 10).join(', ')}${toolResult.value.data.length > 10 ? '...' : ''} (${toolResult.value.data.length} total)`
      );
    } else if (toolResult.status === 'rejected') {
      const message =
        toolResult.reason instanceof Error
          ? toolResult.reason.message
          : String(toolResult.reason);
      console.warn(
        `[opencode-rules] Warning: Failed to query tool IDs: ${message}`
      );
    }

    if (mcpResult.status === 'fulfilled' && mcpResult.value?.data) {
      const mcpIds = extractConnectedMcpCapabilityIDs(mcpResult.value.data);
      for (const id of mcpIds) {
        ids.add(id);
      }
      if (mcpIds.length > 0) {
        this.debugLog(`MCP capability IDs: ${mcpIds.join(', ')}`);
      }
    } else if (mcpResult.status === 'rejected') {
      const message =
        mcpResult.reason instanceof Error
          ? mcpResult.reason.message
          : String(mcpResult.reason);
      console.warn(
        `[opencode-rules] Warning: Failed to query MCP status: ${message}`
      );
    }

    return Array.from(ids);
  }

  private async onSessionCompacting(
    input: { sessionID?: string },
    output: { context?: string[] }
  ): Promise<void> {
    const sessionID = input?.sessionID;
    if (!sessionID) {
      this.debugLog('No sessionID in compacting hook input');
      return;
    }

    const sessionState = this.sessionStore.get(sessionID);
    if (!sessionState || sessionState.contextPaths.size === 0) {
      this.debugLog(
        `No context paths for session ${sessionID} during compaction`
      );
      return;
    }

    this.sessionStore.markCompacting(sessionID, this.now());

    const sortedPaths = Array.from(sessionState.contextPaths).sort((a, b) =>
      a.localeCompare(b)
    );
    const maxPaths = 20;
    const pathsToInclude = sortedPaths.slice(0, maxPaths);

    const contextString = [
      'OpenCode Rules: Working context',
      'Current file paths in context:',
      ...pathsToInclude.map(p => `  - ${sanitizePathForContext(p)}`),
      ...(sortedPaths.length > maxPaths
        ? [`  ... and ${sortedPaths.length - maxPaths} more paths`]
        : []),
    ].join('\n');

    if (!output.context) {
      output.context = [];
    }

    output.context.push(contextString);

    this.debugLog(
      `Added ${pathsToInclude.length} context path(s) to compaction for session ${sessionID}`
    );
  }
}
