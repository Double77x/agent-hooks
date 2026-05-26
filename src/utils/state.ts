import * as fs from "node:fs";
import * as path from "node:path";

export const getStateDir = (): string => {
  const dir = path.join(process.cwd(), ".ai-hooks", "state");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

export const readState = <T>(key: string, defaultValue: T): T => {
  try {
    const file = path.join(getStateDir(), `${key}.json`);
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf8")) as T;
    }
  } catch (err) {
    process.stderr.write(`[ai-hooks:state] Error reading state '${key}': ${(err as Error).message}\n`);
  }
  return defaultValue;
};

export const writeState = <T>(key: string, value: T): void => {
  try {
    const file = path.join(getStateDir(), `${key}.json`);
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
  } catch (err) {
    process.stderr.write(`[ai-hooks:state] Error writing state '${key}': ${(err as Error).message}\n`);
  }
};
