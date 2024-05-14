import { exec, spawn, execFile, ChildProcess } from 'child_process';
import { findBinaryPath } from '../fs';
import { BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { updateModel } from '../routes/message';
// @ts-ignore
import log from 'electron-log/main';
import { AppSettings } from '../AppSettings';

const commandObj = {
	cmd: null as ChildProcess | null,
};

// by default, llamacpp uses template embedded in gguf if available
// TODO any way to get this from the model?
const chatTemplateMap: { [key: string]: string } = {
	Moistral: 'vicuna',
	'WizardLM-2': 'vicuna',
	'Lexi-': 'chatml',
	'Hermes-2': 'chatml',
	'Llama-3': 'llama3',
	'llama-3': 'llama3',
};

const contextLengthMap: { [key: string]: number } = {
	'WizardLM-2': 4096,
	'Lexi-': 8192,
	'Llama-3': 8192,
	'llama-3': 8192,
};

let lastModel = '';
let pid = 0;
let hasResolved = false;

// TODO i think error 3221225781 means vcredist is needed

let isReady = false;

function startServer(model: string, gpuLayers = 99) {
	return new Promise<void>(async (resolve, reject) => {
		const isExternal =
			(await AppSettings.get('selected_provider_chat')) === 'external';
		const apiKey = (await AppSettings.get('external_api_key')) as string;
		const selectedChatModel = (await AppSettings.get(
			'selected_model_chat'
		)) as string;

		if (isExternal) {
			if (!apiKey) {
				log.error('External API key not set');
				reject();
				return;
			}
			if (!selectedChatModel) {
				log.error('External model not set');
				reject();
				return;
			}
			return;
		}

		model = path.normalize(model);
		gpuLayers = Math.floor(+gpuLayers);
		const serverPath = await findBinaryPath('llamafile', 'llamafile');
		const args = [
			'--nobrowser',
			'--model',
			model,
			'--n-gpu-layers',
			gpuLayers + '',
		];

		const chatTemplate = Object.keys(chatTemplateMap).find((key) =>
			model.includes(key)
		);
		if (chatTemplate) {
			args.push('--chat-template', chatTemplateMap[chatTemplate]);
			log.info('Using chat template:', chatTemplateMap[chatTemplate]);
		}

		const contextLength = Object.keys(contextLengthMap).find((key) =>
			model.includes(key)
		);
		if (contextLength && contextLengthMap[contextLength]) {
			args.push('-c', contextLengthMap[contextLength] + '');
			log.info('Using context length:', contextLengthMap[contextLength]);
		} else {
			args.push('-c', '4096');
			log.info('Using default context length:', 4096);
		}

		log.info('Llama.cpp Server Path:', serverPath);
		log.info('Starting Llama.cpp Server with args:', args);
		// NOTE do not use shell: true -- keeps server running as zombie
		commandObj.cmd = execFile(
			serverPath,
			args,
			{ windowsHide: true, killSignal: 'SIGKILL' },
			(error: any, stdout: any, stderr: any) => {
				console.log('execFile callback', commandObj.cmd?.pid);
				if (error) {
					console.error(`Llama.cpp-Server error: ${error.message}`);
					if (reject) {
						hasResolved = false;
						isReady = false;
						reject();
					}
				}
				if (stdout) console.log(`Llama.cpp-Server stdout: ${stdout}`);
				if (stderr) console.error(`Llama.cpp-Server stderr: ${stderr}`);
			}
		);
		pid = commandObj.cmd.pid || 0;
		commandObj.cmd.stdin?.end();
		updateModel(model);

		commandObj.cmd.on('error', (error: any) => {
			log.error(`Llama.cpp-Server Error: ${error.message}`);
			if (reject) {
				hasResolved = false;
				isReady = false;
				reject();
			}
		});

		commandObj.cmd.on('exit', (code: any, signal: any) => {
			if (code) {
				log.warn(`Llama.cpp-Server exited with code: ${code}`);
			}
			if (signal) {
				log.warn(`Llama.cpp-Server killed with signal: ${signal}`);
			}
			isReady = false;
		});

		process.stdin.resume(); // so the program will not close instantly

		async function exitHandler(options: any, exitCode: any) {
			// TODO clean up all the onReadys
			isReady = false;
			await stopServer();
			if (options.cleanup) console.log('clean');
			if (exitCode || exitCode === 0) console.log(exitCode);
			if (options.exit) process.exit();
		}

		process.on('exit', exitHandler.bind(null, { cleanup: true }));
		process.on('SIGINT', exitHandler.bind(null, { exit: true }));
		process.on('SIGTERM', exitHandler.bind(null, { exit: true }));
		process.on('SIGUSR1', exitHandler.bind(null, { exit: true }));
		process.on('SIGUSR2', exitHandler.bind(null, { exit: true }));
		process.on('uncaughtException', exitHandler.bind(null, { exit: true }));

		commandObj.cmd.stdout?.on('data', (data: any) => {
			const str = data.toString();
			if (!hasResolved && str?.includes('all slots are idle')) {
				log.info('Llama.cpp-Server ready');
				hasResolved = true;
				isReady = true;
				resolve();
			}
		});
	});
}

async function stopServer() {
	if (pid) {
		log.info('stopping llama.cpp server', pid);
		process.kill(pid);
		commandObj.cmd = null;
		pid = 0;
		updateModel(''); // reset model
	}
}

async function isServerRunning() {
	return isReady;
}

export default function llamaCppModule(mainWindow: BrowserWindow) {
	log.info('[-] MODULE::llamacpp Initializing');

	ipcMain.handle(
		'llamacpp/start',
		async (_, modelPath: string, nGpuLayers: number) => {
			if (await isServerRunning()) {
				return { message: 'Server already running' };
			}
			lastModel = modelPath;
			await startServer(modelPath, nGpuLayers);
			return { message: 'Server started' };
		}
	);

	ipcMain.handle('llamacpp/stop', async () => {
		await stopServer();
		return { message: 'Server stopped' };
	});

	ipcMain.handle('llamacpp/status', async () => {
		return { isRunning: await isServerRunning() };
	});

	ipcMain.handle('llamacpp/lastModel', async () => {
		return { lastModel };
	});
}
