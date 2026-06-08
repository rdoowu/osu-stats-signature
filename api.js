import { platform } from './platform.js';

// Cache the access token so we don't request a new one every time
let cachedToken = null;
let tokenExpiry = 0;

const getAccessToken = async () => {
	if (cachedToken && Date.now() < tokenExpiry) {
		return cachedToken;
	}
	const data = await platform.httpPost('https://osu.ppy.sh/oauth/token', {
		client_id: parseInt(process.env.OSU_CLIENT_ID),
		client_secret: process.env.OSU_CLIENT_SECRET,
		grant_type: 'client_credentials',
		scope: 'public'
	});
	cachedToken = data.access_token;
	tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
	return cachedToken;
};

export const getUser = async (username, playmode = 'std', includeTopPlays = false, includeSkills = false) => {
	if (username == '@example') {
		return JSON.parse(platform.readTextFile('/assets/example/user.json'));
	}

	const playmodes = {
		std: 'osu',
		taiko: 'taiko',
		catch: 'fruits',
		mania: 'mania',
	};

	if (!playmodes[playmode]) {
		return { error: `Invalid playmode ${playmode}` };
	}

	let token;
	try {
		token = await getAccessToken();
	} catch (error) {
		return { error: `Failed to get access token: ${error.message}` };
	}

	let userData;
	try {
		const response = await platform.httpGetWithHeaders(
			`https://osu.ppy.sh/api/v2/users/${encodeURIComponent(username)}/${playmodes[playmode]}?key=username`,
			{ 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
		);
		userData = JSON.parse(response);
	} catch (error) {
		const statusCode = error.response?.statusCode || error.statusCode;
		if (statusCode === 404) {
			return { error: `User ${username} not found` };
		}
		return { error: `Unknown Error: ${error.message}` };
	}

	// Shape the data to match what render.js expects
	const data = {
		current_mode: playmode,
		user: {
			id: userData.id,
			username: userData.username,
			avatar_url: userData.avatar_url,
			cover_url: userData.cover.url,
			country_code: userData.country_code,
			country: {
				name: userData.country.name,
				code: userData.country_code,
			},
			is_supporter: userData.is_supporter,
			support_level: userData.support_level,
			user_achievements: userData.user_achievements ?? [],
			statistics: {
				level: userData.statistics.level,
				pp: userData.statistics.pp,
				global_rank: userData.statistics.global_rank,
				country_rank: userData.statistics.country_rank,
				hit_accuracy: userData.statistics.hit_accuracy,
				play_count: userData.statistics.play_count,
				play_time: userData.statistics.play_time,
				ranked_score: userData.statistics.ranked_score,
				total_score: userData.statistics.total_score,
				total_hits: userData.statistics.total_hits,
				maximum_combo: userData.statistics.maximum_combo,
				replays_watched_by_others: userData.statistics.replays_watched_by_others,
				grade_counts: userData.statistics.grade_counts,
			},
		},
		top_ranks: {
			best: { items: [] },
			firsts: { count: 0 },
		},
	};

	if (includeTopPlays) {
		try {
			const bestResponse = await platform.httpGetWithHeaders(
				`https://osu.ppy.sh/api/v2/users/${userData.id}/scores/best?mode=${playmodes[playmode]}&limit=1`,
				{ 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
			);
			const firstsResponse = await platform.httpGetWithHeaders(
				`https://osu.ppy.sh/api/v2/users/${userData.id}/scores/firsts?mode=${playmodes[playmode]}&limit=1`,
				{ 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
			);
			data.top_ranks.best = { items: JSON.parse(bestResponse) };
			// firsts endpoint doesn't return count directly, use cursor_string workaround
			const firstsParsed = JSON.parse(firstsResponse);
			data.top_ranks.firsts = { count: userData.scores_first_count ?? 0 };
		} catch (error) {
			// leave defaults
		}
	}

	if (includeSkills) {
		data.user.skills = await getUserOsuSkills(userData.username);
	}

	return data;
};

export const getImage = async (url) => {
	if (url.startsWith('example_')) {
		return platform.readBinaryFile(`/assets/example/${url}`);
	}
	return platform.httpGetBuffer(url);
};

export const getImageBase64 = async (url) => {
	if (url.startsWith('example_')) {
		const data = platform.readBinaryFile(`/assets/example/${url}`);
		return 'data:image/png;base64,' + Buffer.from(data).toString('base64');
	}
	const data = await platform.httpGetBuffer(url);
	return 'data:image/png;base64,' + Buffer.from(data).toString('base64');
};

export const getUserOsuSkills = async (username) => {
	const calcSingleSkill = (value, globalRank, countryRank) => {
		value = parseInt(value);
		globalRank = parseInt(globalRank);
		countryRank = parseInt(countryRank);
		return {
			value,
			globalRank,
			countryRank,
			percent: Math.min(value / 1000 * 100, 100)
		};
	};

	let body;
	try {
		body = await platform.httpGet(`https://osuskills.com/user/${username}`);
	} catch (error) {
		return { error: 'Failed to get skills data' };
	}

	try {
		const cheerio = (await import('cheerio')).default;
		const $ = cheerio.load(body);
		const values = $('.skillsList .skillValue');
		const globalRanks = $('#ranks .skillTop .world');
		const countryRanks = $('#ranks .skillTop .country');
		const names = ['stamina', 'tenacity', 'agility', 'accuracy', 'precision', 'reaction', 'memory'];
		let result = { skills: {}, tags: [] };
		for (let i = 0; i <= 6; i++) {
			result.skills[names[i]] = calcSingleSkill(
				values[i].children[0].data,
				globalRanks[i].children[0].data.substring(1),
				countryRanks[i].children[0].data.substring(1)
			);
		}
		const tags = $('.userRank .userRankTitle');
		for (let i of tags) {
			result.tags.push(i.children[0].data.trim());
		}
		return result;
	} catch (error) {
		return null;
	}
};
