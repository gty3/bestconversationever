import type { RequestHandler } from './$types';
import { RedisClient } from '$lib/server/redis';
import { json } from '@sveltejs/kit';
import { RECAPTCHA_ENABLED } from '$env/static/private';
import { assert } from '$lib/assert';
import { verifyRecaptcha } from '$lib/server/recaptcha-verify';
import { scoreThresholds } from '$lib/recaptcha-client';

export const POST: RequestHandler = async ({ locals, request }) => {
    try {
        const reqBody = await request.json() as { recaptchaToken: string };

        if (RECAPTCHA_ENABLED !== "0") {
            assert(reqBody.recaptchaToken, 'No Recaptcha Token Provided');

            const response = await verifyRecaptcha(reqBody.recaptchaToken);

            assert(response.success, 'Recaptcha verification failed');
            assert(response.score >= scoreThresholds.chat, 'Are you a bot?\nRecaptcha score too low.');
        }
        const redis = new RedisClient();
        const convoList = await redis.getConversationList(locals.session.user.id);

        return json(convoList);
    }
    catch (e) {
        console.error('Failed to retrieve inbox from api', e);
        return json([]);
    }
};