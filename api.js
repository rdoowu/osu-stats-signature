import { platform } from './platform.js';

const getAccessToken = async () => {
	const response = await platform.httpGet('https://osu.ppy.sh/oauth/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			client_id: process.env.OSU_CLIENT_ID,
			client_secret: process.env.OSU_CLIENT_SECRET,
			grant_type: 'client_credentials',
			scope: 'public'
		})
	});
	const data = JSON.parse(response);
	return data.access_token;
};
