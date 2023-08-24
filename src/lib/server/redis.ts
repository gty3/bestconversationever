import { packConversationListItem, type Conversation, type ConversationList, unpackConversationListItem } from "$lib/conversation";
import { REDIS_CONNECTION_URL, REDIS_DEV_ITEM_TTL_SECONDS } from "$env/static/private";
import { createClient, type RedisClientType } from 'redis';
import { getEnvironmentPrefix } from "./environment";

export interface SortedSetIndex {
    key: string;
    score: number;
    value: string;
}

export interface ChatKey {
    key: string;
    indexes: SortedSetIndex[];
}

export class RedisClient {
    private internalClient: RedisClientType;

    public constructor() {
        this.internalClient = createClient({ url: REDIS_CONNECTION_URL, socket: { tls: true } });
        this.internalClient.on('error', (e) => { throw e; });
    }

    public static generateChatKey(convo: Conversation): ChatKey {
        const prefix = getEnvironmentPrefix();
        const time = Date.now();
        const convoKey = `${prefix}:convo:${convo.conversationId}`;
        const idxValue = packConversationListItem({
            convoKey,
            consversationId: convo.conversationId,
            characterName: convo.character,
            userId: convo.userId,
            userName: convo.userName,
        });

        return {
            key: convoKey,
            indexes: [
                // { key: `${prefix}:idx_convo_time`, score: time, member: convoKey },
                { key: `${prefix}:idx_convo_user:${convo.userId}`, score: time, value: idxValue },
                { key: `${prefix}:idx_convo_char:${convo.character.toLowerCase()}`, score: time, value: idxValue },
            ]
        }
    }

    public async keyExists(key: string): Promise<boolean> {
        try {
            if (!this.internalClient.isReady) {
                await this.internalClient.connect();
            }
            return (await this.internalClient.exists(key)) === 1;
        }
        finally {
            await this.internalClient.disconnect();
        }
    }

    public async getConversation(conversationId: string): Promise<Conversation | null> {
        try {
            const convoKey = `${getEnvironmentPrefix()}:convo:${conversationId}`;

            if (!this.internalClient.isReady) {
                await this.internalClient.connect();
            }

            const result = await this.internalClient.json.get(convoKey);


            return result as unknown as Conversation | null;

        }
        catch (e) {
            // TODO: log
            return null;
        }
        finally {
            if (this.internalClient.isReady) {
                await this.internalClient.disconnect();
            }
        }
    }

    public async getConversationList(userId: string): Promise<ConversationList> {
        try {
            const key = `${getEnvironmentPrefix()}:idx_convo_user:${userId}`;

            if (!this.internalClient.isReady) {
                await this.internalClient.connect();
            }

            const result = await this.internalClient.zRangeWithScores(key, 0, -1);


            return result.map(item => {
                const time = new Date(item.score);
                const convoListItem = unpackConversationListItem(item.value);

                return {
                    time,
                    ...convoListItem,
                }
            });
        }
        catch (e) {
            // TODO: log
            return [];
        }
        finally {
            if (this.internalClient.isReady) {
                await this.internalClient.disconnect();
            }
        }
    }

    public async saveConversation(convo: Conversation): Promise<boolean> {
        try {
            const chatKey = RedisClient.generateChatKey(convo);


            if (!this.internalClient.isReady) {
                await this.internalClient.connect();
            }


            const keyExists = (await this.internalClient.exists(chatKey.key)) === 1;
            const redisPromises: Promise<unknown>[] = [];


            // Append the new messages if the conversation exists
            if (keyExists) {
                redisPromises.push(
                    this.internalClient.json.arrAppend(
                        chatKey.key, '$.messages', ...convo.messages));
            }
            else {
                redisPromises.push(
                    this.internalClient.json.set(
                        chatKey.key, '$', convo));
            }

            // Updated the indexes so the score/time gets updated
            for (const item of chatKey.indexes) {
                redisPromises.push(
                    this.internalClient.zAdd(item.key, { score: item.score, value: item.value }));
            }

            // expire dev items
            if (getEnvironmentPrefix() !== 'prod') {
                const ttl = parseInt(REDIS_DEV_ITEM_TTL_SECONDS || "86400", 10);

                redisPromises.push(this.internalClient.expire(chatKey.key, ttl));

                for (const item of chatKey.indexes) {
                    redisPromises.push(
                        this.internalClient.expire(item.key, ttl));
                }

            }

            await Promise.all(redisPromises);

            return true;
        }
        catch (e) {
            return false;
        }
        finally {
            if (this.internalClient.isReady) {
                await this.internalClient.disconnect();
            }
        }
    }
}
