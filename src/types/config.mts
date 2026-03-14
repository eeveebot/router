'use strict';

// Blocklist entry interface - follows same pattern as command registration
export interface BlocklistEntry {
  pattern: string; // regex pattern to match against message text
  enabled?: boolean;
  description?: string;
  platform?: string; // regex pattern to match platform
  network?: string; // regex pattern to match network
  instance?: string; // regex pattern to match instance
  channel?: string; // regex pattern to match channel
  user?: string; // regex pattern to match user
}

// Router configuration interface
export interface RouterConfig {
  blocklist?: BlocklistEntry[];
}
