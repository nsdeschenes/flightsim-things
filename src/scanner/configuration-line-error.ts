type ConfigurationLineReason = 'missing-section' | 'missing-equals';

class ConfigurationLineError extends Error {
  public override name = 'ConfigurationLineError';
  public readonly reason: ConfigurationLineReason;
  public readonly lineNumber: number;

  public constructor(reason: ConfigurationLineReason, lineNumber: number) {
    super(`Invalid aircraft configuration line (${reason}) at line ${lineNumber}`);
    this.reason = reason;
    this.lineNumber = lineNumber;
  }
}

export default ConfigurationLineError;
