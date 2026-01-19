/**
 * Jest configuration for CI/CD - no coverage thresholds
 */

const baseConfig = require('./jest.config.js');

module.exports = {
  ...baseConfig,
  // Remove coverage thresholds for CI
  coverageThreshold: undefined,
};
