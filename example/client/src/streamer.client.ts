import type { LLMResponse } from './llm.service.js';

export interface StreamerClientConfig {
  baseUrl: string;
  presetId: string;
}

export class StreamerClient {
  private readonly baseUrl: string;
  private readonly presetId: string;

  constructor(config: StreamerClientConfig) {
    this.baseUrl = config.baseUrl;
    this.presetId = config.presetId;
  }

  async startStream(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/stream/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ presetId: this.presetId })
    });

    if (!response.ok) {
      throw new Error(`Failed to start stream: ${response.status}`);
    }

    const data = await response.json();
    console.log('[StreamerClient] Stream started:', data);
  }

  async stopStream(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/stream/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`Failed to stop stream: ${response.status}`);
    }

    console.log('[StreamerClient] Stream stopped');
  }

  async sendText(llmResponse: LLMResponse): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/stream/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        presetId: this.presetId,
        requests: [
          {
            action: 'speak',
            params: {
              text: llmResponse.text,
              emotion: llmResponse.emotion
            }
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to send text: ${response.status}`);
    }

    console.log('[StreamerClient] Text sent');
  }
}
