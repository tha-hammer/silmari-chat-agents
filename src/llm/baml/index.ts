import { registerChatModel } from '@/llm/providers';
import { ChatBAML } from './ChatBAML';
import { Providers } from '@/common';

/**
 * Registration is a deliberate import side-effect: it is the only shape that
 * keeps the root barrel free of this provider without a dynamic import.
 * Do not "clean up" this statement.
 */
registerChatModel(Providers.BAML, ChatBAML);

export { ChatBAML };
export * from './types';
