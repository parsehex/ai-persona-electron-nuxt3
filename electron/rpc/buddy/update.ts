import { v4 as uuidv4 } from 'uuid';
import type { ChatThread, BuddyVersionMerged } from '@/types/db';
import { insert, select, update } from '@/sql';
import type { UpdateBuddyOptions } from '@/types/api';
import { all, get, run } from '@/modules/db';

export async function updateBuddy({
	id,
	name,
	tts_voice,
	description,
	profile_pic,
	profile_pic_prompt,
	profile_pic_use_prompt = true,
	appearance_options,
	selected_appearance_options,
}: UpdateBuddyOptions): Promise<BuddyVersionMerged> {
	let returningBuddy: BuddyVersionMerged = null as any;

	const sqlBuddy = select('persona', ['*'], { id });
	let buddy = (await get(sqlBuddy[0], sqlBuddy[1])) as BuddyVersionMerged;
	if (!buddy) {
		throw new Error('Buddy not found');
	}

	const sqlCurrentVersion = select('persona_version', ['*'], {
		id: buddy.current_version_id,
	});
	const currentVersion = (await get(
		sqlCurrentVersion[0],
		sqlCurrentVersion[1]
	)) as BuddyVersionMerged;
	if (!currentVersion) {
		throw new Error('Current version not found');
	}

	const makeNewVersion = !!(name || description);

	if (makeNewVersion) {
		returningBuddy = { ...buddy };

		const newVersionId = uuidv4();
		const newVersion = currentVersion.version + 1;
		const versionName = name || currentVersion.name;
		const versionDescription = description || currentVersion.description;

		const sqlNewVersion = insert('persona_version', {
			id: newVersionId,
			created: new Date().getTime(),
			persona_id: id,
			version: newVersion,
			name: versionName,
			description: versionDescription,
		});
		await run(sqlNewVersion[0], sqlNewVersion[1]);
		returningBuddy.version = newVersion;
		returningBuddy.name = versionName;
		returningBuddy.description = versionDescription;

		const sqlUpdateBuddy = update(
			'persona',
			{ current_version_id: newVersionId, updated: new Date().getTime() },
			{ id }
		);
		await run(sqlUpdateBuddy[0], sqlUpdateBuddy[1]);
		const sqlBuddyGet = select('persona', ['*'], { id });
		buddy = (await get(sqlBuddyGet[0], sqlBuddyGet[1])) as BuddyVersionMerged;

		const sqlThreads = select('chat_thread', ['*'], {
			persona_id: id,
			persona_mode_use_current: true,
		});
		const threads = (await all(sqlThreads[0], sqlThreads[1])) as ChatThread[];
		if (threads.length) {
			const sqlUpdateThreads = threads.map((thread) => {
				return update(
					'chat_thread',
					{ current_persona_version_id: newVersionId },
					{ id: thread.id }
				);
			});
			await Promise.all(sqlUpdateThreads.map((sql) => run(sql[0], sql[1])));
		}
	}

	const dataToUpdate: Record<string, any> = {
		updated: new Date().getTime(),
	};
	if (tts_voice) dataToUpdate.tts_voice = tts_voice;
	if (profile_pic) dataToUpdate.profile_pic = profile_pic;
	if (profile_pic_prompt) dataToUpdate.profile_pic_prompt = profile_pic_prompt;
	if (profile_pic_use_prompt)
		dataToUpdate.profile_pic_use_prompt = profile_pic_use_prompt;
	if (appearance_options) dataToUpdate.appearance_options = appearance_options;
	if (selected_appearance_options)
		dataToUpdate.selected_appearance_options = selected_appearance_options;

	if (Object.keys(dataToUpdate).length === 1) {
		return returningBuddy;
	}
	const sqlUpdateBuddy = update('persona', dataToUpdate, { id });
	await run(sqlUpdateBuddy[0], sqlUpdateBuddy[1]);
	const sqlBuddyGet = select('persona', ['*'], { id });
	buddy = (await get(sqlBuddyGet[0], sqlBuddyGet[1])) as BuddyVersionMerged;
	if (!returningBuddy) {
		returningBuddy = { ...buddy };
		returningBuddy.version = currentVersion.version;
		returningBuddy.name = currentVersion.name;
		returningBuddy.description = currentVersion.description;
	}
	returningBuddy.profile_pic = buddy.profile_pic;
	returningBuddy.profile_pic_prompt = buddy.profile_pic_prompt;
	returningBuddy.profile_pic_use_prompt = buddy.profile_pic_use_prompt;

	return returningBuddy;
}