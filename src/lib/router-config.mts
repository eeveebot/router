'use strict';

import fs from 'node:fs';
import yaml from 'js-yaml';
import { log } from '@eeveebot/libeevee';
import { RouterConfig, BlocklistEntry, CompiledBlocklistEntry } from '../types/config.mjs';

const ROUTER_CONFIG_ENV_VAR = 'MODULE_CONFIG_PATH';

/**
 * Load router configuration from YAML file
 * @returns RouterConfig parsed from YAML file
 */
export async function loadRouterConfig(): Promise<RouterConfig> {
  // Get the config file path from environment variable
  const configPath = process.env[ROUTER_CONFIG_ENV_VAR];
  if (!configPath) {
    const msg = `Environment variable ${ROUTER_CONFIG_ENV_VAR} is not set.`;
    log.error(msg, { producer: 'router' });
    throw new Error(msg);
  }

  try {
    // Read the YAML file
    const configFile = fs.readFileSync(configPath, 'utf8');

    // Parse the YAML content
    const config = yaml.load(configFile) as RouterConfig;

    // Validate the blocklist if present
    if (config.blocklist) {
      if (!Array.isArray(config.blocklist)) {
        const msg = 'Invalid router configuration: blocklist must be an array';
        log.error(msg, { producer: 'router', configPath });
        throw new Error(msg);
      }

      // Compile blocklist entries and validate regex patterns
      const compiledBlocklist: CompiledBlocklistEntry[] = [];

      for (const [index, entry] of config.blocklist.entries()) {
        if (!entry.pattern) {
          const msg = `Invalid blocklist entry at index ${index}: pattern is required`;
          log.error(msg, { producer: 'router', configPath });
          throw new Error(msg);
        }

        // Compile and validate each regex field
        const regexFields = ['pattern', 'platform', 'network', 'instance', 'channel', 'user'] as const;
        const compiled: Record<string, RegExp | undefined> = {};
        for (const field of regexFields) {
          const value = entry[field];
          if (value) {
            try {
              compiled[field] = new RegExp(value);
            } catch (error) {
              const msg = `Invalid blocklist entry at index ${index}: ${field} is not a valid regex`;
              log.error(msg, {
                producer: 'router',
                configPath,
                field: String(field),
                pattern: value,
                error: error instanceof Error ? error.message : String(error),
              });
              throw new Error(msg);
            }
          }
        }

        compiledBlocklist.push({
          pattern: compiled.pattern!,
          enabled: entry.enabled,
          description: entry.description,
          platform: compiled.platform,
          network: compiled.network,
          instance: compiled.instance,
          channel: compiled.channel,
          user: compiled.user,
        });
      }

      config.blocklist = compiledBlocklist;

      log.info(
        `Loaded router configuration with ${config.blocklist.length} blocklist entries`,
        {
          producer: 'router',
          configPath,
        }
      );
    } else {
      log.info('Loaded router configuration with no blocklist entries', {
        producer: 'router',
        configPath,
      });
    }

    return config;
  } catch (error) {
    log.error('Failed to load router configuration', {
      producer: 'router',
      configPath,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
