import { describe, expect, it } from 'vitest';
import { parseK6CliOptions } from './k6-runner.js';

describe('k6 command options', () => {
  it('reads the saved command options from the script snapshot', () => {
    expect(parseK6CliOptions('// nexuskit-k6-args: ["--http-debug=full","--no-color"]\nexport default function() {}')).toEqual(['--http-debug=full', '--no-color']);
  });
  it('rejects malformed arguments and options reserved for the report', () => {
    expect(() => parseK6CliOptions('// nexuskit-k6-args: ["other.js"]')).toThrow();
    expect(() => parseK6CliOptions('// nexuskit-k6-args: ["--summary-export=other.json"]')).toThrow();
    expect(() => parseK6CliOptions('// nexuskit-k6-args: invalid')).toThrow();
  });
});
