import { AppSettings } from '@/lib/api/AppSettings';
import { negPromptFromName, posPromptFromName } from '@/lib/prompt/sd';
import { select, update } from '@/lib/sql';
import type { Buddy, BuddyVersion } from '@/lib/api/types-db';
import { ProfilePicQuality } from '@/lib/api/types-api';
import useElectron from '@/composables/useElectron';
import { makePicture } from '@/src/lib/ai/img';

const { dbGet, dbRun, fsAccess, pathJoin } = useElectron();

// TODO handle needing to shut off chat server and restarting after generating image
//   i think this looks like an option to unload chat while generating image

// TODO rewrite

/*
TODO notes about profile pic versioning:
- we would store the profile pic in the version table
- would also keep the pictures themselves
- need to update naming to include the version id
*/

export default async function createProfilePic(
	id: string,
	quality?: ProfilePicQuality,
	gender = ''
) {
	if (!dbGet || !dbRun) throw new Error('dbGet or dbRun is not defined');

	const isExternal = AppSettings.get('selected_provider_image') === 'external';

	const modelDir = AppSettings.get('local_model_directory') as string;
	const selectedImageModel = AppSettings.get('selected_model_image') as string;
	let modelPath = '';

	if (!selectedImageModel) throw new Error('No image model selected');
	if (!isExternal) {
		if (!modelDir) throw new Error('Model directory not set');

		modelPath = await pathJoin(modelDir, selectedImageModel);
		try {
			const exists = await fsAccess(modelPath);
			if (!exists) throw new Error('Image model file not found');
		} catch (e) {
			throw new Error('Image model file not found');
		}
	}

	const sqlPersona = select('persona', ['*'], { id });
	const persona = (await dbGet(sqlPersona[0], sqlPersona[1])) as Buddy;

	if (!persona) {
		throw new Error('Persona not found');
	}

	const sqlCurrentVersion = select('persona_version', ['*'], {
		id: persona.current_version_id,
	});
	const currentVersion = (await dbGet(
		sqlCurrentVersion[0],
		sqlCurrentVersion[1]
	)) as BuddyVersion;

	if (!currentVersion) throw new Error('Persona version not found');

	let extraPrompt = '';
	if (persona.profile_pic_prompt) {
		extraPrompt = persona.profile_pic_prompt;
	}

	let animated = false;

	// does model name contain "illuminati"?
	if (selectedImageModel.includes('illuminati')) {
		animated = true;
	}

	const posPrompt = posPromptFromName(
		currentVersion.name,
		extraPrompt,
		gender,
		animated
	);
	const negPrompt = negPromptFromName(currentVersion.name);

	const filename = `${Date.now()}.png`;
	await makePicture({
		absModelPath: modelPath,
		outputSubDir: persona.id,
		outputFilename: filename,
		posPrompt,
		negPrompt,
		size: 512, // TODO un-hardcode High quality
	});

	const sqlUpdate = update('persona', { profile_pic: filename }, { id });
	await dbRun(sqlUpdate[0], sqlUpdate[1]);

	console.log('created pic', filename);
	return { output: filename };
}
