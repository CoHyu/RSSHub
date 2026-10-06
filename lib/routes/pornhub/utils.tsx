import dayjs from 'dayjs';
import { renderToString } from 'hono/jsx/dom/server';

import { parseRelativeDate } from '@/utils/parse-date';

const defaultDomain = 'https://www.pornhub.com';

const headers = {
    accessAgeDisclaimerPH: 1,
    hasVisited: 1,
};

const renderDescription = (data, showImages = true): string =>
    renderToString(
        <>
            {data.previewVideo ? (
                <video controls preload="metadata" poster={data.poster}>
                    <source src={data.previewVideo} type="video/webm" />
                </video>
            ) : null}
            {showImages && data.poster ? <img src={data.poster} /> : null}
        </>
    );

const extractDateFromImageUrl = (imageUrl) => {
    const matchResult = imageUrl?.match(/(\d{6})\/(\d{2})/);
    return matchResult ? matchResult.slice(1, 3).join('') : null;
};

const getVideoKey = (e, href?: string) => {
    const dataVideoKey = e.attr('data-video-vkey');
    if (dataVideoKey) {
        return dataVideoKey;
    }

    if (!href) {
        return undefined;
    }

    try {
        return new URL(href, defaultDomain).searchParams.get('viewkey') ?? undefined;
    } catch {
        return undefined;
    }
};

const buildThumbnailProxyUrl = (poster: string | undefined, videoKey: string | undefined, thumbnailProxyBase?: string) =>
    poster && videoKey && thumbnailProxyBase ? `${thumbnailProxyBase}/${encodeURIComponent(videoKey)}?url=${encodeURIComponent(poster)}` : poster;

const parseItems = (e, showImages = true, thumbnailProxyBase?: string) => {
    const href = e.find('span.title a').attr('href') ?? e.find('a.js-linkVideoThumb').attr('href');
    const poster = (e.find('img').data('mediumthumb') ?? e.find('img').attr('src')) as string | undefined;
    const videoKey = getVideoKey(e, href);
    const proxiedPoster = buildThumbnailProxyUrl(poster, videoKey, thumbnailProxyBase);

    return {
        title: e.find('span.title a').text().trim() || e.find('a.js-linkVideoThumb').attr('title')?.trim() || '',
        link: href ? new URL(href, defaultDomain).href : defaultDomain,
        description: renderDescription(
            {
                poster: proxiedPoster,
                previewVideo: e.find('img').data('mediabook'),
            },
            showImages
        ),
        image: showImages ? proxiedPoster : undefined,
        author: e.find('.usernameWrap a').text(),
        pubDate: dayjs(extractDateFromImageUrl(poster)).toDate() || parseRelativeDate(e.find('.added').text()),
    };
};

const getRadarDomin = (path: string) => [
    {
        source: [`www.pornhub.com${path}`, `www.pornhub.com${path}/*`],
        target: path,
    },
    ...['de', 'fr', 'es', 'it', 'pt', 'pl', 'rt', 'jp', 'nl', 'cz', 'cn'].map((language) => ({
        source: [`${language}.pornhub.com${path}`, `${language}.pornhub.com${path}/*`],
        target: `${path}/${language}`,
    })),
];

export { buildThumbnailProxyUrl, defaultDomain, getRadarDomin, headers, parseItems, renderDescription };
