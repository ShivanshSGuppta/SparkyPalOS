import fs from 'fs/promises';
import path from 'path';

const rootDir = process.cwd();
const htmlPath = path.join(rootDir, 'SparkyPalOS2.html');
const contractsDir = path.join(rootDir, 'agent-contracts');
const outputDir = path.join(rootDir, 'agent-output');

const baseUrl = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
const model = process.env.AGENT_MODEL || process.env.LLM_MODEL || 'gpt-4o-mini';
const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || '';
const mockMode = process.argv.includes('--mock') || !apiKey;

const AGENTS = [
  {
    id: 1,
    key: 'wallpaper',
    output: 'agent1-wallpaper.md',
    contract: 'agent1.md',
    system: 'You are Agent 1. Focus on wallpaper behavior (Naruto default, Spiderman optional only).'
  },
  {
    id: 2,
    key: 'brand-logo',
    output: 'agent2-brand-logo.md',
    contract: 'agent2.md',
    system: 'You are Agent 2. Focus on SparkyPalOS favicon/logo and brand consistency.'
  },
  {
    id: 3,
    key: 'gita-logo',
    output: 'agent3-gita-logo.md',
    contract: 'agent3.md',
    system: 'You are Agent 3. Focus on dedicated Gita icon rollout across desktop/window/taskbar/app-drive.'
  },
  {
    id: 4,
    key: 'music-adapters',
    output: 'agent4-music-adapters.md',
    contract: 'agent4.md',
    system: 'You are Agent 4. Focus on hybrid legal music provider adapters and data contracts.'
  },
  {
    id: 5,
    key: 'music-ui',
    output: 'agent5-music-ui.md',
    contract: 'agent5.md',
    system: 'You are Agent 5. Focus on music app UX for full/preview badges and hybrid feed behavior.'
  },
  {
    id: 6,
    key: 'prod-docker',
    output: 'agent6-prod-docker.md',
    contract: 'agent6.md',
    system: 'You are Agent 6. Focus on Docker multi-stage and production compose stack.'
  },
  {
    id: 7,
    key: 'prod-proxy-security',
    output: 'agent7-prod-proxy-security.md',
    contract: 'agent7.md',
    system: 'You are Agent 7. Focus on reverse proxy and production security hardening.'
  },
  {
    id: 8,
    key: 'prod-observability',
    output: 'agent8-prod-observability.md',
    contract: 'agent8.md',
    system: 'You are Agent 8. Focus on health checks, restart strategy, diagnostics, and observability.'
  },
  {
    id: 9,
    key: 'tests-contracts',
    output: 'agent9-tests-contracts.md',
    contract: 'agent9.md',
    system: 'You are Agent 9. Focus on test and contract validation for wallpaper/music/production changes.'
  },
  {
    id: 10,
    key: 'regression-ui',
    output: 'agent10-regression-ui.md',
    contract: 'agent10.md',
    system: 'You are Agent 10. Focus on UI regression checks and mobile/tablet behavior.'
  }
];

const SUPERVISOR = {
  id: 11,
  key: 'supervisor',
  output: 'agent11-supervisor-report.md',
  contract: 'agent11.md',
  system: 'You are Agent 11. Supervise all prior outputs and produce final acceptance report.'
};

function stamp() {
  return new Date().toISOString();
}

function nowMs() {
  return Date.now();
}

function buildArtifactList() {
  return [...AGENTS.map((a) => a.output), SUPERVISOR.output, 'final-brief.md', 'run-summary.json'];
}

function mockAgent(spec) {
  return `# Agent ${spec.id}: ${spec.key}\n\nGenerated: ${stamp()}\n\n## Objective\n- ${spec.system}\n\n## Findings\n- Contract sections completed.\n- Implementation-ready notes produced for this track.\n\n## Status\n- PASS\n`;
}

function mockSupervisor(outputs) {
  const refs = AGENTS.map((a) => `- ${a.output}`).join('\n');
  return `# Agent 11 Supervisor Report\n\nGenerated: ${stamp()}\n\n## Inputs\n${refs}\n\n## Contract Checks\n- All 10 worker outputs present.\n- Cross-track consistency validated.\n\n## Risk Summary\n- Critical: 0\n- Major: 0\n- Minor: 0\n\n## Decision\n- PASS\n\n## Trace\n${Object.keys(outputs).map((k) => `- ${k}: integrated`).join('\n')}\n`;
}

function mockFinalBrief(summary) {
  return `# Final Brief\n\nGenerated: ${stamp()}\nMode: mock\n\n## Produced Artifacts\n${buildArtifactList().filter((name) => name !== 'run-summary.json').map((name) => `- agent-output/${name}`).join('\n')}\n\n## Parallel Execution\n- 10 agents executed in parallel worker mode.\n- Agent 11 supervised and merged acceptance gates.\n\n## Outcome\n- ${summary}\n`;
}

async function ensureOutputDir() {
  await fs.mkdir(outputDir, { recursive: true });
}

async function cleanupOutputDir() {
  const files = await fs.readdir(outputDir).catch(() => []);
  const targets = new Set([...buildArtifactList(), ...files.filter((name) => /^agent\d+.*\.md$/i.test(name))]);
  await Promise.all(
    Array.from(targets).map(async (name) => {
      try {
        await fs.unlink(path.join(outputDir, name));
      } catch {
        // Ignore missing files.
      }
    })
  );
}

async function readFileSafe(filePath) {
  return await fs.readFile(filePath, 'utf8');
}

async function loadContracts() {
  const contractMap = {};
  const files = [...AGENTS.map((a) => a.contract), SUPERVISOR.contract];
  await Promise.all(
    files.map(async (file) => {
      const key = path.basename(file, '.md');
      contractMap[key] = await readFileSafe(path.join(contractsDir, file));
    })
  );
  return contractMap;
}

async function llmMarkdown({ system, prompt }) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!res.ok) {
    throw new Error(`LLM request failed (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  return (data?.choices?.[0]?.message?.content || '').trim();
}

async function runWorkerAgent(spec, contract, html) {
  if (mockMode) return mockAgent(spec);
  const prompt = `${contract}\n\n<source_html>\n${html}\n</source_html>\n\nGenerate implementation-facing markdown only.`;
  return await llmMarkdown({ system: spec.system, prompt });
}

async function runSupervisor(contract, html, workerOutputs) {
  if (mockMode) return mockSupervisor(workerOutputs);
  const bundled = AGENTS.map((agent) => `\n<agent id="${agent.id}" key="${agent.key}">\n${workerOutputs[agent.key] || ''}\n</agent>`).join('\n');
  const prompt = `${contract}\n\nValidate and merge these worker outputs:${bundled}\n\n<source_html>\n${html}\n</source_html>`;
  return await llmMarkdown({ system: SUPERVISOR.system, prompt });
}

async function runFinalBrief(workerOutputs, supervisorOutput) {
  if (mockMode) {
    return mockFinalBrief('Supervisor accepted all tracks with zero critical blockers.');
  }
  const prompt = `Create a concise final brief from these outputs:\n\n${AGENTS.map((a) => `# ${a.output}\n${workerOutputs[a.key] || ''}`).join('\n\n')}\n\n# ${SUPERVISOR.output}\n${supervisorOutput}`;
  return await llmMarkdown({
    system: 'You are a release manager. Output concise markdown only.',
    prompt
  });
}

async function main() {
  const startedAt = stamp();
  const t0 = nowMs();
  await ensureOutputDir();
  await cleanupOutputDir();

  const [html, contracts] = await Promise.all([
    readFileSafe(htmlPath),
    loadContracts()
  ]);

  const workerTimings = {};
  const workerOutputs = {};

  await Promise.all(
    AGENTS.map(async (spec) => {
      const begin = nowMs();
      const contract = contracts[`agent${spec.id}`] || '';
      const output = await runWorkerAgent(spec, contract, html);
      workerOutputs[spec.key] = output;
      workerTimings[spec.key] = nowMs() - begin;
      await fs.writeFile(path.join(outputDir, spec.output), output, 'utf8');
    })
  );

  const supervisorBegin = nowMs();
  const supervisorContract = contracts[`agent${SUPERVISOR.id}`] || '';
  const supervisorOutput = await runSupervisor(supervisorContract, html, workerOutputs);
  const supervisorMs = nowMs() - supervisorBegin;
  await fs.writeFile(path.join(outputDir, SUPERVISOR.output), supervisorOutput, 'utf8');

  const finalBegin = nowMs();
  const finalBrief = await runFinalBrief(workerOutputs, supervisorOutput);
  const finalMs = nowMs() - finalBegin;
  await fs.writeFile(path.join(outputDir, 'final-brief.md'), finalBrief, 'utf8');

  const summary = {
    generatedAt: stamp(),
    startedAt,
    finishedAt: stamp(),
    durationMs: nowMs() - t0,
    mode: mockMode ? 'mock' : 'llm',
    model,
    parallelWorkers: AGENTS.length,
    supervisor: SUPERVISOR.id,
    timingsMs: {
      workers: workerTimings,
      supervisor: supervisorMs,
      finalBrief: finalMs
    },
    outputs: buildArtifactList().map((name) => `agent-output/${name}`)
  };

  await fs.writeFile(path.join(outputDir, 'run-summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  console.log('10-agent parallel pipeline + supervisor complete.');
  console.log(summary);
}

main().catch((error) => {
  console.error('Agent pipeline failed:', error.message);
  process.exitCode = 1;
});
