import { describe, expect, it } from 'vitest';
import {
  buildResourceCaption,
  decideFileBlockMode,
  parseResourceFileIds,
} from '../src/handlers/resource';
import type { Resource } from '../src/types';

function resource(overrides: Partial<Resource> = {}): Resource {
  return {
    id: 1,
    short_code: 'AAAA1111',
    file_id: 'file-main',
    file_unique_id: 'unique-main',
    file_ids: '',
    title: '测试资源',
    tags: '测试,资料',
    is_paid: 1,
    price: 5,
    sequence: 0,
    download_count: 0,
    creator_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('resource delivery helpers', () => {
  it('decideFileBlockMode 按文件数与开关拆分/合并消息块', () => {
    expect(decideFileBlockMode(1, true)).toBe('single');
    expect(decideFileBlockMode(2, true)).toBe('separate');
    expect(decideFileBlockMode(2, false)).toBe('media_group');
  });

  it('parseResourceFileIds 解析 JSON 列表并回退单文件', () => {
    expect(
      parseResourceFileIds(resource({ file_ids: JSON.stringify(['a', 'b', 'a']) })),
    ).toEqual(['a', 'b']);
    expect(parseResourceFileIds(resource())).toEqual(['file-main']);
    expect(
      parseResourceFileIds(resource({ file_ids: '{broken json' })),
    ).toEqual(['file-main']);
  });

  it('buildResourceCaption 拼入上下广告并截断超长文案', () => {
    const caption = buildResourceCaption(resource(), '【推广】上方广告', '下方广告');
    expect(caption).toContain('【推广】上方广告');
    expect(caption).toContain('下方广告');
    expect(caption).toContain('价格：5 积分');

    const long = buildResourceCaption(resource({ title: 'x'.repeat(1100) }));
    expect(long.length).toBeLessThanOrEqual(1024);
    expect(long.endsWith('...')).toBe(true);
  });
});
