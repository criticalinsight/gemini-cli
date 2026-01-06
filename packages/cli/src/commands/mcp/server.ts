/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { sessionId, getVersion } from '@google/gemini-cli-core';
import type { CommandModule } from 'yargs';
import { loadCliConfig } from '../../config/config.js';
import { loadSettings } from '../../config/settings.js';

/**
 * Starts an MCP server that exposes Claude Code Gemini CLI's built-in tools.
 */
export const serverCommand: CommandModule = {
    command: 'server',
    describe: 'Start an MCP server to expose Claude Code Gemini CLI tools',
    handler: async () => {
        const cwd = process.cwd();

        // 1. Load settings and config using the CLI's standard initialization
        const loadedSettings = loadSettings(cwd);
        const settings = loadedSettings.merged;

        // Create minimal argv-like object for loadCliConfig
        const argv = {
            query: undefined,
            model: undefined,
            sandbox: undefined,
            debug: undefined,
            prompt: undefined,
            promptInteractive: undefined,
            yolo: false,
            approvalMode: undefined,
            allowedMcpServerNames: undefined,
            allowedTools: undefined,
            experimentalAcp: undefined,
            extensions: undefined,
            listExtensions: undefined,
            resume: undefined,
            listSessions: undefined,
            deleteSession: undefined,
            includeDirectories: undefined,
            screenReader: undefined,
            useWriteTodos: undefined,
            outputFormat: undefined,
            fakeResponses: undefined,
            recordResponses: undefined,
        };

        const config = await loadCliConfig(settings, sessionId, argv, { cwd });

        // 2. Get the tool registry (this creates and registers built-in tools)
        const toolRegistry = await config.createToolRegistry();

        // 3. Create the MCP server
        const version = await getVersion();
        const server = new McpServer({
            name: 'claude-code-gemini-cli-server',
            version: version || '1.0.0',
        });

        // 4. Expose all tools from the registry via MCP
        const tools = toolRegistry.getAllTools();
        for (const tool of tools) {
            console.error(`Registering MCP tool: ${tool.name}`);

            server.registerTool(
                tool.name,
                {
                    description: tool.description || `Claude Code Gemini CLI ${tool.name} tool`,
                    inputSchema: {},
                },
                async (args: Record<string, unknown>) => {
                    try {
                        const toolInvocation = tool.build(args || {});
                        const result = await toolInvocation.execute(
                            new AbortController().signal,
                        );

                        if (result.error) {
                            return {
                                content: [
                                    { type: 'text' as const, text: `Error: ${result.error.message}` },
                                ],
                                isError: true,
                            };
                        }

                        // Convert llmContent to string (may be string or Part[])
                        const textContent = typeof result.llmContent === 'string'
                            ? result.llmContent
                            : JSON.stringify(result.llmContent);

                        return {
                            content: [{ type: 'text' as const, text: textContent }],
                        };
                    } catch (error: unknown) {
                        const message =
                            error instanceof Error ? error.message : String(error);
                        return {
                            content: [{ type: 'text' as const, text: `Internal Error: ${message}` }],
                            isError: true,
                        };
                    }
                },
            );
        }

        // 5. Connect and start the server
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error('Claude Code Gemini CLI MCP server started on stdio');
    },
};
