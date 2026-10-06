import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { load } from 'cheerio';
import type { Context } from 'hono';

import InvalidParameterError from '@/errors/types/invalid-parameter';
import type { Route } from '@/types';
import got from '@/utils/got';

import { headers } from './utils';

const cacheDir = process.env.PORNHUB_THUMBNAIL_CACHE_DIR || '/data/pornhub-thumbnails';
const maxImageBytes = 10 * 1024 * 1024;

const responseHeaders = (contentType: string) => ({
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=604800, stale-while-revalidate=2592000',
    'X-Content-Type-Options': 'nosniff',
});

const validateSource = (source: string) => {
    const url = new URL(source);
    if (url.protocol !== 'https:' || (url.hostname !== 'phncdn.com' && !url.hostname.endsWith('.phncdn.com'))) {
        throw new InvalidParameterError('Invalid Pornhub thumbnail URL');
    }
    return url.href;
};

const detectContentType = (data: Buffer) => {
    if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return 'image/png';
    }
    if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
        return 'image/jpeg';
    }
    if (data.length >= 6 && (data.subarray(0, 6).toString() === 'GIF87a' || data.subarray(0, 6).toString() === 'GIF89a')) {
        return 'image/gif';
    }
    if (data.length >= 12 && data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP') {
        return 'image/webp';
    }
    if (data.length >= 12 && data.subarray(4, 12).toString().includes('ftypavif')) {
        return 'image/avif';
    }
    throw new Error('Pornhub thumbnail response is not a supported image');
};

const fetchThumbnail = async (source: string) => {
    const response = await got(source, {
        headers: {
            ...headers,
            referer: 'https://www.pornhub.com/',
        },
        responseType: 'buffer',
    });

    if (response.data.length > maxImageBytes) {
        throw new Error('Pornhub thumbnail is too large');
    }

    return {
        data: response.data,
        contentType: detectContentType(response.data),
    };
};

const resolveFreshThumbnail = async (videoKey: string) => {
    const videoUrl = `https://www.pornhub.com/view_video.php?viewkey=${encodeURIComponent(videoKey)}`;
    const { data } = await got(videoUrl, { headers });
    const $ = load(data);
    const source =
        $('meta[property="og:image"]').attr('content') ||
        $('meta[name="twitter:image"]').attr('content') ||
        $('link[rel="image_src"]').attr('href');

    if (!source) {
        throw new Error('Unable to resolve a fresh Pornhub thumbnail');
    }

    return validateSource(source);
};

const readCachedThumbnail = async (videoKey: string) => {
    const imagePath = join(cacheDir, `${videoKey}.bin`);
    const metaPath = join(cacheDir, `${videoKey}.json`);
    const [data, metaRaw] = await Promise.all([readFile(imagePath), readFile(metaPath, 'utf8')]);
    const meta = JSON.parse(metaRaw) as { contentType?: string };
    return {
        data,
        contentType: meta.contentType || 'image/jpeg',
    };
};

const cacheThumbnail = async (videoKey: string, data: Buffer, contentType: string) => {
    await mkdir(cacheDir, { recursive: true });
    await Promise.all([
        writeFile(join(cacheDir, `${videoKey}.bin`), data),
        writeFile(join(cacheDir, `${videoKey}.json`), JSON.stringify({ contentType })),
    ]);
};

export const route: Route = {
    path: '/thumbnail/:videoKey',
    categories: ['multimedia'],
    example: '/pornhub/thumbnail/ph5fb0ed6bd76fa',
    parameters: {
        videoKey: 'Pornhub video viewkey',
        url: 'optional signed Pornhub thumbnail URL used to populate the persistent cache',
    },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
        nsfw: true,
    },
    radar: [],
    name: 'Thumbnail Cache',
    maintainers: ['CoHyu'],
    handler,
};

async function handler(ctx: Context) {
    const { videoKey } = ctx.req.param();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(videoKey)) {
        throw new InvalidParameterError('Invalid Pornhub video key');
    }

    try {
        const cached = await readCachedThumbnail(videoKey);
        return new Response(cached.data as BodyInit, { headers: responseHeaders(cached.contentType) });
    } catch {
        // Cache miss. Continue with the signed source URL, then fall back to resolving a fresh URL.
    }

    let thumbnail;
    const source = ctx.req.query('url');

    if (source) {
        try {
            thumbnail = await fetchThumbnail(validateSource(source));
        } catch {
            // The signed CDN URL may have expired or may reject this edge. Resolve a fresh one below.
        }
    }

    if (!thumbnail) {
        const freshSource = await resolveFreshThumbnail(videoKey);
        thumbnail = await fetchThumbnail(freshSource);
    }

    await cacheThumbnail(videoKey, thumbnail.data, thumbnail.contentType);
    return new Response(thumbnail.data as BodyInit, { headers: responseHeaders(thumbnail.contentType) });
}

export default handler;
