import { resolve } from 'node:path';
import { LevelPipeline } from './levelPipeline.ts';

const [action, ...args] = process.argv.slice(2);
const options = new Map<string, string>();
try {
  const accepted = ['--project', '--out', '--board', '--rules', '--level', '--plan', '--confirm'];
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index], value = args[index + 1];
    if (!name || !accepted.includes(name) || options.has(name) || !value || value.startsWith('--')) throw new Error('Expected unique named options with values');
    options.set(name, value);
  }
  const required = (name: string): string => { const value = options.get(name); if (!value) throw new Error(`Missing ${name}`); return value; };
  if (action === 'sandbox') {
    if (options.size !== 1 || !options.has('--out')) throw new Error('sandbox accepts --out only');
    console.log(`Sandbox created: ${LevelPipeline.createSandbox(resolve(required('--out')))}`);
  } else if (action === 'preview') {
    if (options.has('--plan') || options.has('--confirm')) throw new Error('preview does not import');
    const pipeline = new LevelPipeline(options.get('--project'));
    const result = pipeline.preview(LevelPipeline.readJson(required('--board')), LevelPipeline.readJson(required('--rules')),
      Number(required('--level')), resolve(required('--out')));
    console.log(JSON.stringify({ status: result.witness.status, targetLevel: result.witness.targetLevel, transported: result.witness.transported,
      plan: result.plan, confirm: result.confirm, diff: 'preview.diff beside plan', scope: result.witness.scope }, null, 2));
  } else if (action === 'apply') {
    if (options.size !== 3 || !options.has('--project') || !options.has('--plan') || !options.has('--confirm')) throw new Error('apply requires --project/--plan/--confirm only');
    new LevelPipeline(required('--project')).apply(resolve(required('--plan')), required('--confirm'));
    console.log('Explicit sandbox import completed; production project remains unchanged');
  } else {
    throw new Error('Use sandbox --out <new external root>; preview --board <json> --rules <json> --level <1–60> --out <new external dir> [--project <sandbox>]; apply --project <sandbox> --plan <json> --confirm <SHA256>');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
