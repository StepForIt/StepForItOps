import { StoragePort, StorageTargetConfig } from '@nwm/core';

/** Upload multipart vers Google Drive (API v3). */
export class GdriveStorageAdapter implements StoragePort {
  async uploadFile(
    config: StorageTargetConfig,
    params: { name: string; content: string; mimeType?: string },
  ): Promise<{ id?: string; url?: string }> {
    const metadata = {
      name: params.name,
      ...(config.folderId ? { parents: [config.folderId] } : {}),
    };
    const boundary = 'nwm-boundary';
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: ${params.mimeType ?? 'application/json'}\r\n\r\n` +
      `${params.content}\r\n--${boundary}--`;

    const response = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Google Drive upload → ${response.status}: ${text.slice(0, 300)}`);
    }
    const json = (await response.json()) as { id?: string; webViewLink?: string };
    return { id: json.id, url: json.webViewLink };
  }

  async listFiles(config: StorageTargetConfig): Promise<Array<{ id: string; name: string }>> {
    const query = [config.folderId ? `'${config.folderId}' in parents` : null, 'trashed = false']
      .filter(Boolean)
      .join(' and ');
    const files: Array<{ id: string; name: string }> = [];
    let pageToken: string | undefined;
    do {
      const url =
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}` +
        `&fields=nextPageToken,files(id,name)&pageSize=1000` +
        (pageToken ? `&pageToken=${pageToken}` : '');
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${config.accessToken}` },
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Google Drive list → ${response.status}: ${text.slice(0, 300)}`);
      }
      const json = (await response.json()) as {
        files?: Array<{ id: string; name: string }>;
        nextPageToken?: string;
      };
      files.push(...(json.files ?? []));
      pageToken = json.nextPageToken;
    } while (pageToken);
    return files;
  }

  async readFile(config: StorageTargetConfig, params: { fileId: string }): Promise<string | null> {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${params.fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${config.accessToken}` },
    });
    if (!response.ok) return null;
    return response.text();
  }

  async deleteFile(config: StorageTargetConfig, params: { fileId: string }): Promise<{ deleted: boolean }> {
    // Corbeille plutôt que suppression définitive : récupérable pendant 30 jours.
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${params.fileId}?fields=id`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ trashed: true }),
    });
    if (response.status === 404) return { deleted: false };
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Google Drive delete → ${response.status}: ${text.slice(0, 300)}`);
    }
    return { deleted: true };
  }

  async updateFile(
    config: StorageTargetConfig,
    params: { fileId: string; name: string; content: string; mimeType?: string },
  ): Promise<{ id?: string; url?: string; missing?: boolean }> {
    const boundary = 'nwm-boundary';
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify({ name: params.name })}\r\n` +
      `--${boundary}\r\nContent-Type: ${params.mimeType ?? 'application/json'}\r\n\r\n` +
      `${params.content}\r\n--${boundary}--`;

    const response = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${params.fileId}?uploadType=multipart&fields=id,webViewLink`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );
    if (response.status === 404) return { missing: true };
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Google Drive update → ${response.status}: ${text.slice(0, 300)}`);
    }
    const json = (await response.json()) as { id?: string; webViewLink?: string };
    return { id: json.id, url: json.webViewLink };
  }
}
