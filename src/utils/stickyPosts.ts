import type { CollectionEntry } from 'astro:content';

type BlogPost = CollectionEntry<'blog'>;

function stickyIsActive(post: BlogPost, now = Date.now()) {
	if (!post.data.sticky) return false;
	if (!post.data.stickyUntil) return true;
	return post.data.stickyUntil.valueOf() > now;
}

export function sortPostsWithSticky(posts: BlogPost[]) {
	const now = Date.now();
	return [...posts].sort((a, b) => {
		const stickyA = stickyIsActive(a, now);
		const stickyB = stickyIsActive(b, now);
		if (stickyA !== stickyB) return stickyA ? -1 : 1;
		return b.data.pubDate.valueOf() - a.data.pubDate.valueOf();
	});
}
