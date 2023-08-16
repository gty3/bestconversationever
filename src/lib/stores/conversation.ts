import { Personality } from "$lib/personality";
import type { ChatApiRequest } from "$lib/chat-api-request";
import type { ChatApiResponse } from "$lib/chat-api-response";
import { writable, get, type Writable, type Unsubscriber } from "svelte/store";
import { nanoid } from 'nanoid'
import { getRecaptchaToken } from "$lib/recaptcha-client";
import type { User } from "$lib/user";
import { ChatEvents, sendChatEvent } from "$lib/analytics";

export interface ConversationItem {
    role: 'user' | 'assistant';
    name: string;
    time?: Date;
    text?: string;
    waitingForResponse: boolean;
}

export interface Conversation {
    messages: ConversationItem[];
    // waitingForResponse: boolean;
}

export class ConversationStore {
    public store: Writable<Conversation>;
    private conversationId: string;
    private personality: Personality;
    public subscribe: Unsubscriber;

    constructor(private user: User, personality?: Personality) {
        this.personality = personality || new Personality();
        this.conversationId = nanoid();
        this.store = writable<Conversation>({ messages: [] });
        this.subscribe = this.store.subscribe;
    }

    public async set(text: string): Promise<void> {

        // Add the user message
        const userMsg: ConversationItem = {
            name: this.user.name,
            role: 'user',
            time: new Date(),
            waitingForResponse: false,
            text,
        };

        this.store.update((conversation: Conversation) => {
            return {
                messages: [
                    ...conversation.messages,
                    userMsg,
                ]
            };
        });

        const previousMessages = get<Conversation>(this.store).messages;

        // TODO: store this max client value somewhere else
        if (previousMessages.length > 15) {
            previousMessages.splice(0, previousMessages.length - 15);
        }

        const token = await getRecaptchaToken('chat');

        const apiRequest: ChatApiRequest = {
            id: nanoid(),
            conversationId: this.conversationId,
            personality: this.personality.export(),
            message: userMsg.text || '',
            time: userMsg.time || new Date(),
            previousMessages,
            recaptchaToken: token,
        };


        const responseMsg: ConversationItem = {
            name: apiRequest.personality.name,
            role: 'assistant',
            waitingForResponse: true,
        };

        this.store.update((conversation: Conversation) => {
            return {
                messages: [
                    ...conversation.messages,
                    responseMsg]
            };
        });

        // TODO: Add estimated token count
        sendChatEvent(ChatEvents.chatSent, { character: apiRequest.personality.name });

        const apiCall = await fetch('/api/chat', {
            method: 'POST',
            body: JSON.stringify(apiRequest),
        });

        const apiResponse = await apiCall.json() as ChatApiResponse;


        responseMsg.time = new Date();
        responseMsg.text = apiResponse.message;
        responseMsg.waitingForResponse = false;

        this.store.update((conversation: Conversation) => {
            conversation.messages.pop();
            return { messages: [...conversation.messages, responseMsg] };
        });

        sendChatEvent(ChatEvents.chatReceived, {
            character: apiRequest.personality.name, gptTokens: apiResponse.responseTokens
        });
    }

    public setPersonality(personality: Personality): void {
        this.personality = personality;
    }
}
