/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  getAgentPreferenceKey,
  getCustomAgentDefaultMode,
} from '@/renderer/pages/guid/hooks/agentSelectionUtils';

describe('agentSelectionUtils', () => {
  describe('getAgentPreferenceKey', () => {
    it('uses the row id for custom agents so preferences stay row-scoped', () => {
      expect(getAgentPreferenceKey({ agent_source: 'custom', id: 'custom-agent-1' }, 'codex')).toBe('custom-agent-1');
    });

    it('falls back to the backend slot for non-custom agents', () => {
      expect(getAgentPreferenceKey({ agent_source: 'builtin', id: 'builtin-codex' }, 'codex')).toBe('codex');
      expect(getAgentPreferenceKey(undefined, 'aionrs')).toBe('aionrs');
    });
  });

  describe('getCustomAgentDefaultMode', () => {
    it('prefers the persisted yolo_id for custom agents', () => {
      expect(
        getCustomAgentDefaultMode({
          agent_source: 'custom',
          backend: 'codex',
          yolo_id: 'full-access',
        })
      ).toBe('full-access');
    });

    it('falls back to the backend full-auto mode when yolo_id is missing', () => {
      expect(
        getCustomAgentDefaultMode({
          agent_source: 'custom',
          backend: 'claude',
        })
      ).toBe('bypassPermissions');
    });

    it('returns undefined for non-custom agents', () => {
      expect(
        getCustomAgentDefaultMode({
          agent_source: 'builtin',
          backend: 'codex',
          yolo_id: 'full-access',
        })
      ).toBeUndefined();
    });
  });
});
