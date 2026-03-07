import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Java Server Manager', () => {
	test('activates and registers core commands', async () => {
		const extension = vscode.extensions.all.find(
			(candidate) => candidate.packageJSON?.name === 'java-server-manager'
		);

		assert.ok(extension, 'Extension should be available in the test host');

		await extension!.activate();

		assert.strictEqual(extension!.isActive, true, 'Extension should activate successfully');

		const registeredCommands = await vscode.commands.getCommands(true);
		for (const commandId of [
			'jsm.server.add',
			'jsm.server.startRun',
			'jsm.server.startDebug',
			'jsm.server.stop',
			'jsm.server.openLogs',
			'jsm.server.syncAllDeployments',
			'jsm.deployment.sync',
			'jsm.view.refresh',
			'jsm.diagnostics.copy'
		]) {
			assert.ok(
				registeredCommands.includes(commandId),
				`Expected command ${commandId} to be registered`
			);
		}

		await assert.doesNotReject(async () => {
			await vscode.commands.executeCommand('jsm.view.refresh');
		});
	});
});