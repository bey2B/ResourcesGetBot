import { describe, expect, it } from 'vitest';
import type { InlineKeyboard } from 'grammy';
import {
  buildResourceCaption,
  buildSubscribePrompt,
  decideFileBlockMode,
  parseResourceFileIds,
} from '../src/handlers/resource';
import type { SubscriptionCheckResult } from '../src/services/subscription';
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

describe('buildSubscribePrompt', () => {
  function check(overrides: Partial<SubscriptionCheckResult> = {}): SubscriptionCheckResult {
    return {
      ok: false,
      status: 'not_joined',
      message: '请先关注以下频道后再获取资源',
      channels: [],
      missingChannels: [],
      ...overrides,
    };
  }

  interface ButtonShape {
    url?: string;
    callback_data?: string;
  }

  /** 展平键盘按钮：grammy 的按钮是联合类型，这里统一成可读字段便于断言。 */
  function buttons(keyboard: InlineKeyboard): ButtonShape[] {
    const source = keyboard as unknown as {
      inline_keyboard: ButtonShape[][];
    };
    return source.inline_keyboard.flat();
  }

  it('私密频道用 inviteUrl 生成可点击按钮，而不是只显示频道 ID', () => {
    const prompt = buildSubscribePrompt(
      check({
        channels: [
          {
            channel: '-1001234567890',
            display: '频道 -1001234567890',
            status: 'not_member',
            inviteUrl: 'https://t.me/+AbCdEfGhIjKlMn',
          },
        ],
        missingChannels: ['频道 -1001234567890'],
      }),
      'abcd1234',
    );
    expect(prompt).not.toBeNull();
    const flat = buttons(prompt!.keyboard);
    // 必须有加入按钮 + 我已加入按钮
    expect(flat).toHaveLength(2);
    expect(flat[0].url).toBe('https://t.me/+AbCdEfGhIjKlMn');
    expect(flat[1].callback_data).toBe('sub_recheck:abcd1234');
    // 裸频道 ID 不得出现在文案里暴露内部标识
    expect(prompt!.text).not.toContain('-1001234567890');
  });

  it('公开频道无邀请链接时回退到 @username 公开链接', () => {
    const prompt = buildSubscribePrompt(
      check({
        channels: [{ channel: '@demo_channel', display: '@demo_channel', status: 'not_member' }],
        missingChannels: ['@demo_channel'],
      }),
      'abcd1234',
    );
    expect(buttons(prompt!.keyboard)[0].url).toBe(
      'https://t.me/demo_channel',
    );
  });

  it('多个缺失频道时每个频道一个按钮并带序号', () => {
    const prompt = buildSubscribePrompt(
      check({
        channels: [
          {
            channel: '-1001111111111',
            display: '频道 -1001111111111',
            status: 'not_member',
            inviteUrl: 'https://t.me/+first',
          },
          {
            channel: '-1002222222222',
            display: '频道 -1002222222222',
            status: 'not_member',
            inviteUrl: 'https://t.me/+second',
          },
        ],
        missingChannels: ['频道 -1001111111111', '频道 -1002222222222'],
      }),
      'abcd1234',
    );
    const flat = buttons(prompt!.keyboard);
    expect(flat).toHaveLength(3); // 两个加入按钮 + 我已加入
    expect(flat[0].url).toBe('https://t.me/+first');
    expect(flat[1].url).toBe('https://t.me/+second');
    expect(flat[2].callback_data).toBe('sub_recheck:abcd1234');
  });

  it('没有缺失频道（配置缺失/接口异常）时返回 null，交由调用方回纯文本', () => {
    expect(
      buildSubscribePrompt(check({ status: 'config_missing', channels: [] }), 'abcd1234'),
    ).toBeNull();
    expect(
      buildSubscribePrompt(
        check({
          status: 'api_error',
          channels: [{ channel: '-100', display: '频道 -100', status: 'error' }],
        }),
        'abcd1234',
      ),
    ).toBeNull();
  });
});
