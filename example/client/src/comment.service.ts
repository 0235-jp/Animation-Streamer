import WebSocket from 'ws';
import vm from 'vm';

export interface Comment {
  id: string;
  service: string;
  name: string;
  data: {
    userId: string;
    name: string;
    comment: string;
    profileImage?: string;
    timestamp: number;
  };
}

const ONECOMME_PORT = 11180;

type CommentCallback = (comment: Comment) => void;

interface OneSDKType {
  setup: (config: { port: number; mode: string; permissions: string[] }) => void;
  connect: () => Promise<void>;
  ready: () => Promise<void>;
  subscribe: (options: { action: string; callback: (data: Comment[]) => void }) => number;
  unsubscribe: (id: number) => void;
}

async function loadOneSDK(): Promise<OneSDKType> {
  // SDKをダウンロード
  const sdkUrl = `http://localhost:${ONECOMME_PORT}/templates/preset/__origin/js/onesdk.js`;
  console.log(`[CommentService] Loading SDK from ${sdkUrl}`);

  const response = await fetch(sdkUrl);
  if (!response.ok) {
    throw new Error(`Failed to load SDK: ${response.status}`);
  }
  const sdkCode = await response.text();

  // locationオブジェクトのモック
  const mockLocation = {
    href: 'http://localhost/',
    hostname: 'localhost',
    protocol: 'http:',
    host: 'localhost',
    origin: 'http://localhost',
    pathname: '/',
    search: '',
    hash: '',
  };

  // 分離されたコンテキストを作成
  const context: Record<string, unknown> = {
    // タイマー関連
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,

    // WebSocket
    WebSocket,

    // URL
    URL,

    // console
    console,

    // Promise
    Promise,

    // location
    location: mockLocation,

    // 組み込みオブジェクト
    Object,
    Array,
    String,
    Number,
    Boolean,
    Error,
    TypeError,
    ReferenceError,
    SyntaxError,
    Date,
    Math,
    JSON,
    RegExp,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Symbol,
    Uint8Array,
    ArrayBuffer,
    Int8Array,
    Uint16Array,
    Int16Array,
    Uint32Array,
    Int32Array,
    Float32Array,
    Float64Array,
    DataView,

    // グローバル関数
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    btoa: (str: string) => Buffer.from(str, 'binary').toString('base64'),
    atob: (str: string) => Buffer.from(str, 'base64').toString('binary'),

    // グローバル
    globalThis: {},
  };

  // windowオブジェクトのモック
  const mockWindow: Record<string, unknown> = {
    WebSocket,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    location: {
      href: 'http://localhost/',
      hostname: 'localhost',
      protocol: 'http:',
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    postMessage: () => {},
    requestAnimationFrame: (cb: (time: number) => void) => setTimeout(() => cb(Date.now()), 16),
    cancelAnimationFrame: clearTimeout,
    navigator: { userAgent: 'Node.js' },
    URL,
    OneSDK: null,
  };

  // documentオブジェクトのモック
  const mockDocument = {
    readyState: 'complete',
    visibilityState: 'visible',
    addEventListener: () => {},
    removeEventListener: () => {},
    createElement: () => ({ rel: '', href: '', innerHTML: '' }),
    head: { appendChild: () => {} },
    documentElement: {
      style: {},
    },
    cookie: '',
  };

  context.window = mockWindow;
  context.self = mockWindow;
  context.document = mockDocument;
  context.navigator = mockWindow.navigator;
  context.getComputedStyle = () => ({
    getPropertyValue: () => '',
  });
  context.Blob = class MockBlob {
    constructor() {}
  };
  context.Worker = class MockWorker {
    constructor() {}
    addEventListener() {}
    postMessage() {}
  };
  context.AbortController = AbortController;
  context.FormData = class MockFormData {
    append() {}
  };
  context.XMLHttpRequest = class MockXMLHttpRequest {};
  context.fetch = fetch;
  context.Request = Request;
  context.Response = Response;
  context.Headers = Headers;
  context.ReadableStream = ReadableStream;

  // vmコンテキストを作成
  vm.createContext(context);

  // SDKを実行
  vm.runInContext(sdkCode, context);

  // OneSDKを取得
  const sdk = (context.window as Record<string, unknown>).OneSDK as OneSDKType;

  if (!sdk) {
    throw new Error('Failed to load OneSDK');
  }

  return sdk;
}

export class CommentService {
  private callback: CommentCallback | null = null;
  private subscriptionId: number | null = null;
  private sdk: OneSDKType | null = null;

  async connect(): Promise<void> {
    // SDKをロード
    this.sdk = await loadOneSDK();

    // SDKを初期化
    this.sdk.setup({
      port: ONECOMME_PORT,
      mode: 'diff',
      permissions: ['comments'],
    });

    // 接続
    await this.sdk.connect();
    await this.sdk.ready();
    console.log('[CommentService] Connected to OneComme via SDK');

    // コメントを購読
    this.subscriptionId = this.sdk.subscribe({
      action: 'comments',
      callback: (comments: Comment[]) => {
        for (const comment of comments) {
          if (this.callback) {
            this.callback(comment);
          }
        }
      },
    });
  }

  disconnect(): void {
    if (this.sdk && this.subscriptionId !== null) {
      this.sdk.unsubscribe(this.subscriptionId);
      this.subscriptionId = null;
    }
    console.log('[CommentService] Disconnected from OneComme');
  }

  onComment(callback: CommentCallback): void {
    this.callback = callback;
  }
}
