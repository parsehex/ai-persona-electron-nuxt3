import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { app, BrowserWindow, session, dialog, shell } from 'electron';
import singleInstance from './singleInstance';
import dynamicRenderer from './dynamicRenderer';
// import updaterModule from '../updater';
import macMenuModule from './modules/macMenu';
import { ipcMain } from 'electron/main';
import macMenu from './modules/macMenu';
import db from './modules/db';
import { basename, dirname, join, resolve } from 'path';
import llamaCppModule from './modules/llamacpp';
import { fileURLToPath } from 'url';
import sdModule from './modules/sd';
import { getDataPath } from './fs';
// @ts-ignore
import log from 'electron-log/main';
import piperModule from './modules/piper';
import whisperModule from './modules/whisper';
import { CreateBuddyOptions } from '@/types/api';

import dotenv from 'dotenv';
import rememberWindowState, { loadWindowState } from './window-state';
dotenv.config({
	path: path.join(__dirname, '..', '.env'),
});

log.initialize();
log.errorHandler.startCatching();

// Initilize
// =========
const isProduction = process.env.NODE_ENV !== 'development';
const platform: 'darwin' | 'win32' | 'linux' = process.platform as any;
const architucture: '64' | '32' = os.arch() === 'x64' ? '64' : '32';
const headerSize = 32;

// Initialize app window
// =====================
async function createWindow() {
	console.log('System info', { isProduction, platform, architucture });

	const initialWindowState = loadWindowState();

	// Create the browser window.
	const mainWindow = new BrowserWindow({
		width: initialWindowState.width,
		height: initialWindowState.height,
		x: initialWindowState.x,
		y: initialWindowState.y,
		minWidth: 950,
		maximizable: true,
		webPreferences: {
			// devTools: !isProduction,
			nodeIntegration: true,
			contextIsolation: false,
			preload: path.join(__dirname, 'preload.js'),
		},

		titleBarStyle: 'hiddenInset',
		// frame: platform === 'darwin',
		frame: true,
		titleBarOverlay: platform === 'darwin' && { height: headerSize },
		title: 'BuddyGenAI',
	});

	if (initialWindowState.maximized) {
		mainWindow.maximize();
	}

	rememberWindowState(mainWindow);

	await db(mainWindow);
	await llamaCppModule(mainWindow);
	await sdModule(mainWindow);
	await piperModule(mainWindow);
	await whisperModule(mainWindow);

	mainWindow.removeMenu();

	ipcMain.handle('pathJoin', async (_, path: string, ...paths: string[]) => {
		return join(path, ...paths);
	});
	ipcMain.handle('pathResolve', async (_, path: string, ...paths: string[]) => {
		return resolve(path, ...paths);
	});
	ipcMain.handle('pathDirname', async (_, path: string) => {
		return dirname(path);
	});
	ipcMain.handle('pathBasename', async (_, path: string) => {
		return basename(path);
	});
	ipcMain.handle('fsAccess', async (_, path: string) => {
		try {
			await fs.access(path);
			return true;
		} catch (err) {
			return false;
		}
	});
	ipcMain.handle('fsUnlink', async (_, path: string) => {
		try {
			await fs.unlink(path);
			return true;
		} catch (err) {
			return false;
		}
	});
	ipcMain.handle('listDirectory', async (_, directory: string) => {
		try {
			const files = await fs.readdir(directory);
			return files;
		} catch (err) {
			return [];
		}
	});
	ipcMain.handle('mkdir', async (_, directory: string) => {
		try {
			await fs.mkdir(directory, { recursive: true });
			return true;
		} catch (err) {
			return false;
		}
	});
	ipcMain.handle('fileURLToPath', async (_, url: string) => {
		return fileURLToPath(url);
	});
	ipcMain.handle('openExternalLink', async (_, url: string) => {
		shell.openExternal(url);
	});

	ipcMain.handle('toggleDevTools:app', () => {
		mainWindow.webContents.toggleDevTools();
	});

	ipcMain.handle('pickDirectory:app', async () => {
		const result = await dialog.showOpenDialog({
			properties: ['openDirectory'],
		});

		return result.filePaths[0];
	});

	ipcMain.handle('pickFile:app', async (_, fileType: string) => {
		let extensions = ['safetensors', 'gguf', 'onnx', 'bin'];
		let name = 'Model files';
		if (fileType === 'chat') {
			extensions = ['gguf'];
			name = 'Chat model files';
		} else if (fileType === 'image') {
			extensions = ['safetensors'];
			name = 'Image model files';
		} else if (fileType === 'tts') {
			extensions = ['onnx'];
			name = 'TTS voice files';
		} else if (fileType === 'stt') {
			extensions = ['bin'];
			name = 'STT model files';
		}
		const result = await dialog.showOpenDialog({
			properties: ['openFile', 'multiSelections'],
			filters: [{ name, extensions }],
		});

		if (fileType === 'tts') {
			const onnxFiles = result.filePaths;
			const configFiles = [];
			for (const onnxFile of onnxFiles) {
				const jsonFile = onnxFile + '.json';
				try {
					await fs.access(jsonFile);
					configFiles.push(jsonFile);
				} catch (err) {
					console.log('json file not found for onnx file', onnxFile);
				}
			}
			return [...onnxFiles, ...configFiles];
		}

		return result.filePaths;
	});

	ipcMain.handle('pickPackFile:app', async () => {
		const result = await dialog.showOpenDialog({
			properties: ['openFile'],
			filters: [{ name: 'Model Pack files (.zip)', extensions: ['zip'] }],
		});

		// TODO get files in zip to verify and return

		return result.filePaths;
	});

	ipcMain.handle('importPack:app', async (_, src: string) => {
		// inspect the zip to contain correct files
		// extract the zip to the models directory
		// delete the zip
	});

	ipcMain.handle(
		'moveFile:app',
		async (_, source: string, destination: string) => {
			try {
				await fs.rename(source, destination);
				return true;
			} catch (err) {
				return false;
			}
		}
	);

	ipcMain.handle(
		'linkFile:app',
		async (_, source: string, destination: string) => {
			try {
				await fs.symlink(source, destination);
				return true;
			} catch (err) {
				return false;
			}
		}
	);

	ipcMain.handle('verifyModelDirectory:app', async (_) => {
		console.log('verifyModelDirectory:app');
		const modelsLocations = {
			win32: '%APPDATA%/BuddyGenAI/Models',
			linux: '~/.config/BuddyGenAI/Models',
			darwin: '~/Library/Application Support/BuddyGenAI/Models',
		};

		const isDev = process.env.NODE_ENV === 'development';
		const platform = process.platform;
		// @ts-ignore
		const dir = modelsLocations[platform];
		let modelsPath = '';
		if (isDev) {
			if (platform === 'win32') {
				modelsPath = 'C:/Users/User/BuddyGen Models';
			} else {
				modelsPath = path.join('/home/user/BuddyGen Models');
			}
		} else {
			modelsPath = path.join(dir);
			// resolve ~ and %APPDATA%
			if (platform === 'win32') {
				const appData = process.env.APPDATA;
				if (appData) {
					modelsPath = modelsPath.replace('%APPDATA%', appData);
				}
			} else if (platform === 'linux') {
				modelsPath = modelsPath.replace('~', process.env.HOME as string);
				console.log('l');
			} else if (platform === 'darwin') {
				modelsPath = modelsPath.replace('~', '/Users/' + process.env.USER);
			}
		}

		try {
			await fs.mkdir(modelsPath, { recursive: true });
			return modelsPath;
		} catch (err) {
			return '';
		}
	});

	ipcMain.handle('openModelDirectory:app', async () => {
		const modelsLocations = {
			win32: '%APPDATA%/BuddyGenAI/Models',
			linux: '~/.config/BuddyGenAI/Models',
			darwin: '~/Library/Application Support/BuddyGenAI/Models',
		};

		const isDev = process.env.NODE_ENV === 'development';
		const platform = process.platform;
		// @ts-ignore
		const dir = modelsLocations[platform];
		let modelsPath = '';
		if (isDev) {
			modelsPath = 'C:/Users/User/BuddyGen Models';
		} else {
			modelsPath = path.join(dir);
			// resolve ~ and %APPDATA%
			if (platform === 'win32') {
				const appData = process.env.APPDATA;
				if (appData) {
					modelsPath = modelsPath.replace('%APPDATA%', appData);
				}
			} else if (platform === 'linux') {
				modelsPath = modelsPath.replace('~', process.env.HOME as string);
				console.log('l');
			} else if (platform === 'darwin') {
				modelsPath = modelsPath.replace('~', '/Users/' + process.env.USER);
			}
		}

		shell.openPath(modelsPath);
	});

	ipcMain.handle('getDataPath', async (_, path: string) => {
		return getDataPath(path);
	});

	ipcMain.handle('closeApp', async (_, path: string) => {
		app.quit();
	});

	// Lock app to single instance
	if (singleInstance(app, mainWindow)) return;

	// Open the DevTools.
	!isProduction &&
		mainWindow.webContents.openDevTools({
			mode: 'bottom',
		});

	return mainWindow;
}

// App events
// ==========
app.whenReady().then(async () => {
	if (!isProduction) {
		try {
			await session.defaultSession.loadExtension(
				path.join(__dirname, '../..', '__extensions', 'vue-devtools')
			);
		} catch (err) {
			console.log('[Electron::loadExtensions] An error occurred: ', err);
		}
	}

	session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
		callback({
			responseHeaders: {
				...details.responseHeaders,
				'Content-Security-Policy': ["script-src 'self'"],
			},
		});
	});

	const mainWindow = await createWindow();
	if (!mainWindow) return;

	// Load renderer process
	dynamicRenderer(mainWindow);

	// Initialize modules
	console.log('-'.repeat(30) + '\n[+] Loading modules...');
	// modules.forEach((module) => {
	// 	try {
	// 		module(mainWindow);
	// 	} catch (err: any) {
	// 		console.log('[!] Module error: ', err.message || err);
	// 	}
	// });
	// allow for modules to be async
	// for (let i = 0; i < modules.length; i++) {
	// 	try {
	// 		await modules[i](mainWindow);
	// 	} catch (err: any) {
	// 		console.log('[!] Module error: ', err.message || err);
	// 	}
	// }
	macMenu(mainWindow);
	// updaterModule(mainWindow);

	console.log('[!] Loading modules: Done.' + '\r\n' + '-'.repeat(30));

	app.on('activate', function () {
		// On macOS it's common to re-create a window in the app when the
		// dock icon is clicked and there are no other windows open.
		// if (BrowserWindow.getAllWindows().length === 0) createWindow()
		mainWindow.show();
	});
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});
