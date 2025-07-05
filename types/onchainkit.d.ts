declare module '@coinbase/onchainkit/minikit' {
  export interface MiniKitProps {
    children?: React.ReactNode;
    className?: string;
  }

  export interface MiniKitContext {
    isOpen: boolean;
    isFrameReady: boolean;
    setFrameReady: () => void;
    context: any;
  }

  export interface MiniKitConfig {
    appearance?: {
      theme?: string;
      [key: string]: any;
    };
    [key: string]: any;
  }

  export const MiniKit: React.FC<MiniKitProps>;
  export const MiniKitProvider: React.FC<{
    children: React.ReactNode;
    apiKey?: string;
    chain: any;
    config?: MiniKitConfig;
  }>;

  export interface Frame {
    id: string;
    [key: string]: any;
  }

  export interface AddFrameResult {
    addFrame: (frame: Frame) => void;
    frames: Frame[];
  }

  export function useAddFrame(): AddFrameResult;

  export function useMiniKit(): MiniKitContext & {
    open: () => void;
    close: () => void;
    toggle: () => void;
  };
} 