# Agent Hooks

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white) ![Claude Code](https://img.shields.io/badge/Claude_Code-D97757?style=flat-square) ![Agy CLI](https://img.shields.io/badge/Agy_CLI-4F46E5?style=flat-square) ![Codex](https://img.shields.io/badge/Codex-10A37F?style=flat-square)

An enterprise-grade safety and workflow suite for autonomous AI agents. This repository provides a standardised set of hooks designed to secure the workspace, enforce architectural consistency, and optimise agent reasoning for Claude Code, Agy CLI (Antigravity CLI), and Codex.

## Overview

Agent Hooks acts as a deterministic middleware layer between the AI agent and your local system. By intercepting tool calls before and after execution, the system ensures that every action is safe, compliant with project standards, and backed by a clear implementation plan.

The architecture is built on a lean, side-effect-light core. Each hook is a standalone ESM bundle that communicates via strictly formatted JSON on stdout while piping diagnostics to stderr for transparency.

## Hook Reference

The following table details the hooks currently available in the suite.

| Hook                            | Event         | Utility                                                                                                                          |
| :------------------------------ | :------------ | :------------------------------------------------------------------------------------------------------------------------------- |
| **Block Dangerous Commands**    | Pre-Tool Use  | Detects and prevents destructive shell operations, such as targeting the root filesystem or executing remote scripts directly.   |
| **Protect Secrets**             | Pre-Tool Use  | Shields sensitive files like `.env`, SSH keys, and cloud credentials from being read or exfiltrated by the agent.                |
| **Package Manager Enforcement** | Pre-Tool Use  | Ensures project consistency by mandating the use of `pnpm` for Node.js and `uv` for Python while blocking unauthorised managers. |
| **Require Plan**                | Pre-Tool Use  | Mandates that the agent declares its strategy or implementation details before performing substantial filesystem mutations.      |
| **Definition of Done**          | Pre-Tool Use  | Blocks the agent from finishing a task if the workspace contains linting errors, type mismatches, or failing tests.              |
| **Tool Filter**                 | Pre-Tool Use  | Dynamically restricts the agent to an explicit allowlist of safe tools when operating in restricted or unfamiliar modes.         |
| **Diff Hygiene**                | Pre-Tool Use  | Flags the inclusion of debug logs, debugger statements, unfinished TODO comments, or excessively large diffs.                    |
| **Context Injection**           | Pre-Tool Use  | Automatically feeds relevant project documentation and git history into the agent reasoning process to improve accuracy.         |
| **Auto-Fix**                    | Post-Tool Use | Automatically runs standardised formatters and linters after code mutations to ensure the workspace remains clean.               |

## Why These Hooks Matter

### Safety and Security

Autonomous agents require guardrails to prevent accidental system damage or credential exposure. By using regex-based pattern matching and byte-limited reads, we provide high-confidence protection without compromising performance.

### Workflow Integrity

Ensuring that an agent "thinks" before it "acts" is critical for complex refactoring. Hooks like **Require Plan** and **Definition of Done** transform the agent from a simple tool-user into a disciplined engineer that respects the project lifecycle.

### Architectural Consistency

Standardising the toolchain across different agents ensures that regardless of which CLI you use, the resulting code adheres to the same linting, formatting, and package management rules.

## Getting Started

### Prerequisites

- Node.js (Latest LTS)
- pnpm

### Installation

#### Method 1: Remote One-Liner (Recommended)

Run the following in PowerShell to install the pre-bundled hooks without cloning the repository.

```powershell
irm https://raw.githubusercontent.com/Double77x/agent-hooks/main/install-hooks.ps1 | iex
```

#### Method 2: Local Build

1. Clone the repository and install dependencies.
   ```bash
   pnpm install
   ```
2. Build the standalone ESM bundles.
   ```bash
   pnpm build
   ```
3. Run the installer locally.
   ```powershell
   ./install-hooks.ps1
   ```
4. Configure pre-commit git hooks to automatically build and stage updated bundles on commit.
   ```bash
   npx simple-git-hooks
   ```
   *(This is also automatically run during `pnpm install`)*

### Configuration

You can control hook behaviour using environment variables such as `AI_AGENT_TYPE` (claude, agy, or codex), `AI_SAFETY_LEVEL`, and `AI_HOOK_MODE`. Local workflow rules can be customised via a `.ai-hooks-config.json` file in your project root.

## Contributing

Contributions are welcome to help expand the hook library or improve agent adapters. Please ensure that all new hooks remain synchronous, deterministic, and well-tested.

1. Fork the repository and create a feature branch.
2. Implement your changes using TypeScript and the standardised path aliases.
3. Add a comprehensive test suite in the `tests/` directory mirroring the source structure.
4. Verify your changes by running `pnpm lint`, `pnpm type-check`, and `pnpm test`.
5. Submit a pull request with a clear description of the new functionality or fix.

Please maintain the side-effect-light philosophy, use stderr for diagnostics, and keep the stdout strictly reserved for machine-readable JSON.
