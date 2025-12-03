import { readFileSync } from 'fs';
import { CommentService } from './comment.service.js';
import { LLMService } from './llm.service.js';
import { StreamerClient } from './streamer.client.js';

interface Config {
  llm: {
    apiKey: string;
    model: string;
    systemPrompt: string;
  };
  streamer: {
    baseUrl: string;
    presetId: string;
  };
}

function loadConfig(): Config {
  const configPath = process.env.CONFIG_PATH || 'config.json';
  const content = readFileSync(configPath, 'utf-8');
  return JSON.parse(content);
}

async function main() {
  const config = loadConfig();

  const commentService = new CommentService();
  const llmService = new LLMService(config.llm);
  const streamerClient = new StreamerClient(config.streamer);

  // 起動時: ストリーム開始 & わんコメ接続
  console.log('[Main] Starting stream...');
  await streamerClient.startStream();

  console.log('[Main] Connecting to OneComme...');
  await commentService.connect();

  // コメント受信時の処理
  commentService.onComment(async (comment) => {
    console.log(`[Main] Comment received: ${comment.data.name}: ${comment.data.comment}`);

    try {
      const response = await llmService.generateResponse(comment.data.comment);
      await streamerClient.sendText(response);
    } catch (error) {
      console.error('[Main] Error processing comment:', error);
    }
  });

  console.log('[Main] Ready! Waiting for comments...');

  // 終了時: クリーンアップ
  const cleanup = async () => {
    console.log('\n[Main] Shutting down...');
    commentService.disconnect();
    await streamerClient.stopStream();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((error) => {
  console.error('[Main] Fatal error:', error);
  process.exit(1);
});
