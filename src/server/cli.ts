export interface CliOptions {
  validate: boolean;
  seed: boolean;
}

export function parseCliOptions(argv: string[]): CliOptions {
  return {
    validate: argv.includes("--validate"),
    seed: argv.includes("--seed"),
  };
}
