import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DRIVE_FOLDER_MIME, detectDriveFile, groupDriveFiles, groupForMarket, parseDriveFolderId, type DriveEntry } from './driveFolders';
import { marketOfCampaign } from './markets';

const folder = (name: string, path: string[] = []): DriveEntry => ({ id: `f_${name}`, name, mimeType: DRIVE_FOLDER_MIME, path });
const entry = (name: string, path: string[], extra: Partial<DriveEntry> = {}): DriveEntry => ({
  id: `${path.join('/')}/${name}`, name, mimeType: 'application/zip', path, bytes: 1, ...extra,
});

test('folder ID comes from the usual Drive links or a bare ID', () => {
  const id = '1Fc5_zbPoASkhk1r4buj51vqhXyoYWil7';
  assert.equal(parseDriveFolderId(`https://drive.google.com/drive/folders/${id}`), id);
  assert.equal(parseDriveFolderId(`https://drive.google.com/drive/u/0/folders/${id}?usp=sharing`), id);
  assert.equal(parseDriveFolderId(`https://drive.google.com/open?id=${id}`), id);
  assert.equal(parseDriveFolderId(id), id);
  assert.equal(parseDriveFolderId('https://example.com'), undefined);
});

test('image and video sizes come from Drive metadata; zips from the name or a size subfolder', () => {
  const image = detectDriveFile(entry('banner.jpg', ['Suiza'], { mimeType: 'image/jpeg', image: { width: 300, height: 250 } }));
  assert.deepEqual([image.kind, image.size, image.sizeSource], ['image', '300x250', 'file']);

  const video = detectDriveFile(entry('spot_ctv.mp4', ['Suiza'], { mimeType: 'video/mp4', video: { width: 1920, height: 1080, durationMillis: '20040' } }));
  assert.deepEqual([video.kind, video.size, video.durationSec, video.device], ['video', '1920x1080', 20, 'ctv']);

  const zip = detectDriveFile(entry('banner.zip', ['Suiza', '728x90']));
  assert.deepEqual([zip.kind, zip.size, zip.sizeSource, zip.relativePath], ['html5', '728x90', 'name', 'Suiza/728x90/banner.zip']);

  const mismatch = detectDriveFile(entry('b_300x600.png', ['Suiza'], { mimeType: 'image/png', image: { width: 300, height: 250 } }));
  assert.equal(mismatch.sizeMismatch, true);
});

test('files are grouped by country folder, also when they sit in subfolders', () => {
  const result = groupDriveFiles('Time to Fly octubre', [
    folder('Suiza'), folder('RD'), folder('300x250', ['RD']), folder('Varios'),
    entry('a_300x250.zip', ['Suiza']),
    entry('b_728x90.zip', ['Suiza']),
    entry('c.zip', ['RD', '300x250']),
    entry('d_300x250.zip', ['Varios']),
    entry('suelto_300x250.zip', []),
  ]);
  assert.deepEqual(
    result.groups.map((g) => [g.market?.code, g.folderName, g.files.length]),
    [['DO', 'RD', 1], ['CH', 'Suiza', 2], [undefined, '', 1], [undefined, 'Varios', 1]],
  );
  assert.deepEqual(result.unknownFolders, ['Varios']);
});

test('the folder as the agency sends it: wrapper folder, country folders inside, Mac junk ignored', () => {
  const wrapper = 'Banners RD Y Suiza';
  const gif = (name: string, country: string, width: number, height: number) =>
    entry(name, [wrapper, country], { mimeType: 'image/gif', image: { width, height } });
  const result = groupDriveFiles('tester', [
    folder(wrapper), folder('Suiza', [wrapper]), folder('RD', [wrapper]), folder('__MACOSX', [wrapper]),
    gif('300x250.gif', 'Suiza', 300, 250),
    gif('970x250.gif', 'Suiza', 970, 250),
    gif('120x600.gif', 'RD', 120, 600),
    entry('._300x250.gif', [wrapper, '__MACOSX', 'Suiza'], { mimeType: 'image/gif' }),
    entry('.DS_Store', [wrapper, 'RD'], { mimeType: 'application/octet-stream' }),
  ]);
  assert.deepEqual(
    result.groups.map((g) => [g.market?.code, g.folderName, g.files.map((f) => f.size)]),
    [['DO', 'RD', ['120x600']], ['CH', 'Suiza', ['300x250', '970x250']]],
  );
  assert.deepEqual([result.unknownFolders, result.ignored], [[], 2]);
  assert.equal(result.groups[1].files[0].relativePath, 'Banners RD Y Suiza/Suiza/300x250.gif');
});

test('a link straight to a country folder takes every file for that country', () => {
  const result = groupDriveFiles('España', [entry('a_300x250.zip', []), entry('b.zip', ['728x90'])]);
  assert.deepEqual(result.groups.map((g) => [g.market?.code, g.files.length]), [['ES', 2]]);
});

test('the campaign market picks its country folder, else the loose files at the root', () => {
  const result = groupDriveFiles('tester', [folder('Suiza'), entry('a.zip', ['Suiza']), entry('photo.jpg', [])]);
  assert.equal(groupForMarket(result, marketOfCampaign('ae-ch_kpi360_ttf_dis'))?.folderName, 'Suiza');
  assert.equal(groupForMarket(result, marketOfCampaign('ae-es_kpi360_ttf_dis'))?.folderName, '');
});
