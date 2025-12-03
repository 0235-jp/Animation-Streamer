import { generateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';

const responseSchema = z.object({
  text: z.string().describe('視聴者への返答'),
  emotion: z.enum(['neutral', 'happy', 'sad', 'angry', 'surprised']).describe('返答の感情'),
});

export type LLMResponse = z.infer<typeof responseSchema>;

export interface LLMServiceConfig {
  apiKey: string;
  model: string;
  systemPrompt: string;
}

export class LLMService {
  private readonly openai: ReturnType<typeof createOpenAI>;
  private readonly model: string;
  private readonly systemPrompt: string;

  constructor(config: LLMServiceConfig) {
    this.openai = createOpenAI({ apiKey: config.apiKey });
    this.model = config.model;
    this.systemPrompt = config.systemPrompt;
  }

  async generateResponse(comment: string): Promise<LLMResponse> {
    const result = await generateObject({
      model: this.openai.chat(this.model),
      schema: responseSchema,
      messages: [
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: comment },
      ],
    });

    console.log(`[LLMService] Generated: "${result.object.text}" (${result.object.emotion})`);
    return result.object;
  }
}
