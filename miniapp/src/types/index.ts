/* Mini App types and interfaces */

export interface User {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  photo_url?: string;
}

export interface ConnectedWallet {
  address: string;
  type: 'telegram' | 'argentx' | 'braavos';
  balance_strk: string;
  balance_smainer: string;
}

export interface AIModel {
  name: string;
  display_name: string;
  type: 'text' | 'image' | 'multimodal';
  description: string;
  vram_required: number;
  cost_per_token: number;
  capabilities?: string[];
  provider_count?: number;
}

export interface Conversation {
  id: string;
  created_at: string;
  updated_at: string;
  messages: Message[];
  model_used: string;
  total_cost: string;
  on_chain_hash?: string; // if stored on-chain
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;  
  content_type: 'text' | 'image';
  timestamp: string;
  inference_time?: number;
  cost?: string;
  nft_id?: string; // if minted as NFT
}

export interface NFTMetadata {
  id: string;
  name: string;
  description: string;
  image_url: string;
  prompt: string;
  model_used: string;
  generation_time: number;
  creator: string;
  minted_at: string;
  price?: string;
  royalties: {
    creator: number;
    ai_model_operator: number;
    platform: number;
  };
}

export interface UserProfile {
  user_id: number;
  wallet_address: string;
  preferred_model: string;
  conversation_count: number;
  nfts_created: number;
  total_spent: string;
  privacy_settings: {
    store_conversations: boolean;
    public_gallery: boolean;
    share_usage_data: boolean;
  };
}

export interface ComputeNode {
  id: string;
  starknet_address: string;
  gpu_info: string;
  vram_gb: number;
  ram_gb: number;
  current_tasks: number;
  reputation_score: number;
  supported_models: string[];
  price_per_second: string;
  location?: string;
}

export interface TaskSubmission {
  type: 'text_generation' | 'image_generation';
  prompt: string;
  model: string;
  parameters?: {
    max_tokens?: number;
    temperature?: number;
    image_size?: '512x512' | '1024x1024';
  };
  user_id: number;
  conversation_id?: string;
}

export interface TaskResult {
  task_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: {
    content: string;
    content_type: 'text' | 'image_url';
    execution_time: number;
    node_id: string;
  };
  error?: string;
  cost: string;
}

// Starknet contract interactions
export interface SMAINERTokenState {
  balance: string;
  allowances: Record<string, string>;
  staking_balance: string;
  compute_credits: string;
}

export interface NFTFactoryState {
  user_nfts: NFTMetadata[];
  marketplace_listings: NFTMetadata[];
  royalty_earnings: string;
}

// Telegram Mini App specific
export interface WebAppInitData {
  user?: User;
  chat?: {
    id: number;
    type: string;
    title?: string;
  };
  auth_date: number;
  hash: string;
}

export interface WebAppAction {
  type: 'generate_text' | 'generate_image' | 'mint_nft' | 'update_profile' | 'purchase_credits';
  payload: any;
}

// AI Inference Request/Response types
export interface InferenceRequest {
  model_name: string;
  prompt: string;
  max_tokens?: number;
  temperature?: number;
  callback_url?: string;
  metadata?: {
    user_address: string;
    session_id: string;
  };
}

export interface InferenceResponse {
  task_id: string;
  status: 'submitted' | 'processing' | 'completed' | 'failed';
  result?: string;
  error?: string;
  cost?: string;
  execution_time?: number;
}

export interface InferenceTaskStatus {
  task_id: string;
  status: 'submitted' | 'processing' | 'completed' | 'failed';
  result?: string;
  error?: string;
  cost?: string;
  execution_time?: number;
  node_id?: string;
}

// Component props interfaces
export interface ChatInterfaceProps {
  user: User;
  wallet: ConnectedWallet;
  onSendMessage: (message: string, type: 'text' | 'image') => void;
}

export interface ModelSelectorProps {
  models: AIModel[];
  selected_model: string;
  onModelSelect: (model_id: string) => void;
}

export interface NFTGalleryProps {
  nfts: NFTMetadata[];
  onMintNFT: (message_id: string) => void;
  onListNFT: (nft_id: string, price: string) => void;
}

export interface WalletConnectProps {
  onConnect: (wallet: ConnectedWallet) => void;
  onDisconnect: () => void;
}

// API response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

export type ConversationResponse = ApiResponse<Conversation>;
export type ModelsResponse = ApiResponse<AIModel[]>;
export type TaskResponse = ApiResponse<TaskResult>;
export type NFTResponse = ApiResponse<NFTMetadata>;
export type ProfileResponse = ApiResponse<UserProfile>;