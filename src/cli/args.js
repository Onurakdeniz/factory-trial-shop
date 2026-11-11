// Command-line arguments: `<command> [positionals] [--name value | --name=value | --flag]`.
// An option given more than once becomes a list.

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.exitCode = 2;
  }
}

export function parseArgs(argv) {
  const positionals = [];
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const equals = arg.indexOf('=');
    const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
    let value;
    if (equals !== -1) {
      value = arg.slice(equals + 1);
    } else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) {
      value = argv[i + 1];
      i += 1;
    } else {
      value = true;
    }
    options[name] = name in options ? [].concat(options[name], value) : value;
  }
  const [command = 'help', ...rest] = positionals;
  return { command, positionals: rest, options };
}

/** An option's values as a list (absent: empty list). */
export function optionList(options, name) {
  const value = options[name];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function requireOption(options, name) {
  const value = options[name];
  if (value === undefined || value === true) throw new UsageError(`--${name} <value> is required`);
  if (Array.isArray(value)) throw new UsageError(`--${name} may be given only once`);
  return value;
}
