export interface SecretProvider {
  get(name: string): Promise<string>;
}

export class EnvironmentSecretProvider implements SecretProvider {
  readonly #environment: NodeJS.ProcessEnv;
  readonly #allowedNames: Set<string>;

  constructor(allowedNames: readonly string[], environment: NodeJS.ProcessEnv = process.env) {
    this.#allowedNames = new Set(allowedNames);
    this.#environment = environment;
  }

  async get(name: string) {
    if (!this.#allowedNames.has(name)) {
      throw new Error(`Secret ${name} is not in the runtime allow-list`);
    }

    const value = this.#environment[name]?.trim();

    if (!value) {
      throw new Error(`Required secret ${name} is not configured`);
    }

    return value;
  }
}
