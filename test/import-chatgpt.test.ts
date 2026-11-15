import { describe, it, expect } from 'vitest';
import { parseChatGPTConversations } from '../scripts/import-chatgpt.js';

describe('ChatGPT Export Parser (import-chatgpt.ts)', () => {
  it('parses standard ChatGPT export with mapping node graph', () => {
    const chatgptJson = JSON.stringify([
      {
        title: 'CUDA Memory Management Discussion',
        create_time: 1700000000.5,
        mapping: {
          'root-node': {
            id: 'root-node',
            message: null,
            children: ['node-1'],
          },
          'node-1': {
            id: 'node-1',
            message: {
              id: 'm1',
              author: { role: 'user' },
              create_time: 1700000001,
              content: {
                content_type: 'text',
                parts: ['How do I allocate unified memory in CUDA?'],
              },
            },
            parent: 'root-node',
            children: ['node-2'],
          },
          'node-2': {
            id: 'node-2',
            message: {
              id: 'm2',
              author: { role: 'assistant' },
              create_time: 1700000005,
              content: {
                content_type: 'text',
                parts: ['You use cudaMallocManaged(&ptr, bytes).'],
              },
            },
            parent: 'node-1',
            children: [],
          },
        },
      },
    ]);

    const parsed = parseChatGPTConversations(chatgptJson);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe('CUDA Memory Management Discussion');
    expect(parsed[0].createdAt).toBe(1700000000500);
    expect(parsed[0].messages).toHaveLength(2);
    expect(parsed[0].messages[0].role).toBe('user');
    expect(parsed[0].messages[0].content).toBe('How do I allocate unified memory in CUDA?');
    expect(parsed[0].messages[0].createdAt).toBe(1700000001000);
    expect(parsed[0].messages[1].role).toBe('assistant');
    expect(parsed[0].messages[1].content).toBe('You use cudaMallocManaged(&ptr, bytes).');
    expect(parsed[0].messages[1].createdAt).toBe(1700000005000);
  });

  it('parses linear simplified ChatGPT format', () => {
    const linearJson = JSON.stringify([
      {
        title: 'Linear Chat',
        create_time: 1710000000,
        messages: [
          { role: 'user', content: 'What is PyTorch?', create_time: 1710000001 },
          { role: 'assistant', content: 'PyTorch is an open-source machine learning framework.', create_time: 1710000005 },
        ],
      },
    ]);

    const parsed = parseChatGPTConversations(linearJson);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].messages).toHaveLength(2);
    expect(parsed[0].messages[0].content).toBe('What is PyTorch?');
  });
});

