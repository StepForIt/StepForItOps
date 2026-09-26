'use client';

import React from 'react';
import { Image, Space, Tag, Tooltip, Typography, message as toast } from 'antd';
import { CloseCircleFilled, FileTextOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { API_URL } from '../lib/api';
import { BRAND } from '../lib/brand/colors';

/**
 * Pièces jointes du chat : captures d'écran ET fichiers texte (JSON exporté,
 * CSV, log). Côté composeur (avant envoi) et côté conversation (après). L'API
 * refuse les mêmes formats et les mêmes poids — ces bornes-ci ne sont qu'un
 * refus immédiat, pour ne pas téléverser 20 Mo avant de lire l'erreur.
 */
const ACCEPTED_IMAGES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES = 4;

/** Extensions acceptées, doublon assumé du domaine : le web ne dépend pas de `@nwm/core`. */
const FILE_EXTENSIONS = [
  'txt',
  'log',
  'md',
  'markdown',
  'json',
  'csv',
  'tsv',
  'xml',
  'html',
  'yml',
  'yaml',
  'sql',
  'js',
  'ts',
  'py',
  'sh',
  'ini',
  'conf',
  'toml',
];
const MAX_FILE_BYTES = 256 * 1024;
export const MAX_FILES = 5;
/** Poids cumulé des fichiers d'un message, borne de l'API reprise à l'identique. */
const MAX_FILES_BYTES = 400 * 1024;

export const ACCEPT_ATTR = [...ACCEPTED_IMAGES, ...FILE_EXTENSIONS.map((extension) => `.${extension}`)].join(
  ',',
);

export interface PendingImage {
  /** Clé locale : la pièce jointe n'a pas encore d'id, elle n'existe pas côté API. */
  key: string;
  name: string;
  /** Data-URL complète : sert d'aperçu ET de contenu envoyé (l'API sait la démonter). */
  dataUrl: string;
}

export interface PendingFile {
  key: string;
  name: string;
  mediaType: string;
  /** Contenu texte : le fichier est lu ici, l'API n'a rien à décoder. */
  text: string;
  size: number;
}

export interface MessageAttachment {
  id: string;
  mediaType: string;
  /** Nom du fichier joint ; absent pour une capture, affichée en vignette. */
  name?: string | null;
  size: number;
}

type AttachmentsT = ReturnType<typeof useTranslations<'chat.attachments'>>;

function readDataUrl(file: File, failure: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(failure));
    reader.readAsDataURL(file);
  });
}

function readText(file: File, failure: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(failure));
    reader.readAsText(file);
  });
}

function extensionOf(name: string): string {
  return name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
}

/** Un fichier est texte par son extension, ou par le type que le navigateur en dit. */
function isTextFile(file: File): boolean {
  return FILE_EXTENSIONS.includes(extensionOf(file.name)) || file.type.startsWith('text/');
}

export function formatSize(size: number, t: AttachmentsT): string {
  if (size < 1024) return t('size.bytes', { size: String(size) });
  if (size < 1024 * 1024) return t('size.kilobytes', { size: String(Math.round(size / 1024)) });
  return t('size.megabytes', { size: (size / (1024 * 1024)).toFixed(1) });
}

/**
 * Pièces jointes en attente d'envoi. `add` refuse ce qui ne partirait pas et le
 * dit tout de suite : un fichier écarté en silence se découvre dans la réponse
 * de l'IA, qui parle alors d'une capture qu'elle n'a jamais reçue.
 */
export function useChatAttachments() {
  const t = useTranslations('chat.attachments');
  const [images, setImages] = React.useState<PendingImage[]>([]);
  const [files, setFiles] = React.useState<PendingFile[]>([]);

  const addImage = React.useCallback(
    async (file: File): Promise<boolean> => {
      if (!ACCEPTED_IMAGES.includes(file.type)) {
        toast.error(t('errors.imageFormat', { name: file.name }));
        return true;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        toast.error(
          t('errors.imageTooLarge', { name: file.name, size: (file.size / 1024 / 1024).toFixed(1) }),
        );
        return true;
      }
      let dataUrl: string;
      try {
        dataUrl = await readDataUrl(file, t('errors.readFailed', { name: file.name }));
      } catch (error) {
        toast.error((error as Error).message);
        return true;
      }
      let overflow = false;
      setImages((previous) => {
        if (previous.length >= MAX_IMAGES) {
          overflow = true;
          return previous;
        }
        return [
          ...previous,
          {
            key: `${file.name}-${previous.length}-${Date.now()}`,
            name: file.name || t('defaultImageName'),
            dataUrl,
          },
        ];
      });
      if (overflow) toast.warning(t('errors.tooManyImages', { max: MAX_IMAGES }));
      return !overflow;
    },
    [t],
  );

  const addFile = React.useCallback(
    async (file: File): Promise<boolean> => {
      if (file.size > MAX_FILE_BYTES) {
        toast.error(
          t('errors.fileTooLarge', {
            name: file.name,
            size: formatSize(file.size, t),
            max: formatSize(MAX_FILE_BYTES, t),
          }),
        );
        return true;
      }
      let text: string;
      try {
        text = await readText(file, t('errors.readFailed', { name: file.name }));
      } catch (error) {
        toast.error((error as Error).message);
        return true;
      }
      if (!text.trim()) {
        toast.error(t('errors.emptyFile', { name: file.name }));
        return true;
      }
      let refused: string | null = null;
      setFiles((previous) => {
        if (previous.length >= MAX_FILES) {
          refused = t('errors.tooManyFiles', { max: MAX_FILES });
          return previous;
        }
        const total = previous.reduce((sum, item) => sum + item.size, 0) + file.size;
        if (total > MAX_FILES_BYTES) {
          refused = t('errors.filesTooHeavy', { max: formatSize(MAX_FILES_BYTES, t) });
          return previous;
        }
        return [
          ...previous,
          {
            key: `${file.name}-${previous.length}-${Date.now()}`,
            name: file.name || t('defaultFileName'),
            mediaType: file.type || 'text/plain',
            text,
            size: file.size,
          },
        ];
      });
      if (refused) toast.warning(refused);
      return !refused;
    },
    [t],
  );

  const add = React.useCallback(
    async (incoming: File[]) => {
      for (const file of incoming) {
        if (file.type.startsWith('image/')) {
          if (!(await addImage(file))) break;
          continue;
        }
        if (isTextFile(file)) {
          if (!(await addFile(file))) break;
          continue;
        }
        toast.error(t('errors.unsupported', { name: file.name }));
      }
    },
    [addImage, addFile, t],
  );

  const remove = React.useCallback((key: string) => {
    setImages((previous) => previous.filter((item) => item.key !== key));
    setFiles((previous) => previous.filter((item) => item.key !== key));
  }, []);

  const clear = React.useCallback(() => {
    setImages([]);
    setFiles([]);
  }, []);

  /** Remet les pièces d'un envoi échoué : elles repartent avec le texte réédité. */
  const restore = React.useCallback((previous: { images: PendingImage[]; files: PendingFile[] }) => {
    setImages(previous.images);
    setFiles(previous.files);
  }, []);

  /** Ce qui part dans le corps de la requête : l'API démonte la data-URL elle-même. */
  const payload = React.useCallback(
    () => ({
      images: images.map((item) => ({ data: item.dataUrl })),
      files: files.map((item) => ({ name: item.name, mediaType: item.mediaType, text: item.text })),
    }),
    [images, files],
  );

  const count = images.length + files.length;

  return { images, files, count, add, remove, clear, restore, payload };
}

/** Vignettes et fichiers en attente, chacun retirable avant l'envoi. */
export function PendingAttachmentStrip({
  images,
  files,
  onRemove,
}: {
  images: PendingImage[];
  files: PendingFile[];
  onRemove: (key: string) => void;
}) {
  const t = useTranslations('chat.attachments');
  if (images.length === 0 && files.length === 0) return null;
  return (
    <Space wrap size={6} style={{ marginTop: 8 }}>
      {images.map((item) => (
        <div key={item.key} style={{ position: 'relative', lineHeight: 0 }}>
          <Image
            src={item.dataUrl}
            alt={item.name}
            width={56}
            height={56}
            style={{ objectFit: 'cover', borderRadius: 6, border: '1px solid #f0f0f0' }}
          />
          <Tooltip title={t('remove')}>
            <CloseCircleFilled
              onClick={() => onRemove(item.key)}
              style={{
                position: 'absolute',
                top: -6,
                right: -6,
                fontSize: 16,
                color: BRAND.slate,
                background: '#fff',
                borderRadius: '50%',
                cursor: 'pointer',
              }}
            />
          </Tooltip>
        </div>
      ))}
      {files.map((item) => (
        <Tag
          key={item.key}
          icon={<FileTextOutlined />}
          closable
          onClose={(event) => {
            event.preventDefault();
            onRemove(item.key);
          }}
          style={{ margin: 0, padding: '4px 8px' }}
        >
          {item.name} · {formatSize(item.size, t)}
        </Tag>
      ))}
      {(images.length >= MAX_IMAGES || files.length >= MAX_FILES) && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {images.length >= MAX_IMAGES && t('imagesFull', { max: MAX_IMAGES })}
          {images.length >= MAX_IMAGES && files.length >= MAX_FILES && ' · '}
          {files.length >= MAX_FILES && t('filesFull', { max: MAX_FILES })}
        </Typography.Text>
      )}
    </Space>
  );
}

/**
 * Pièces d'un message déjà envoyé. Les octets ne sont jamais dans le JSON de la
 * conversation : chacune est demandée à l'API, qui la sert en cache long. Les
 * captures s'affichent, les fichiers se téléchargent — les afficher en clair
 * noierait le fil sous le contenu qu'on venait justement de sortir du message.
 */
export function MessageAttachments({ attachments }: { attachments: MessageAttachment[] }) {
  const t = useTranslations('chat.attachments');
  if (attachments.length === 0) return null;
  const images = attachments.filter((attachment) => !attachment.name);
  const files = attachments.filter((attachment) => attachment.name);
  return (
    <>
      {images.length > 0 && (
        <Image.PreviewGroup>
          <Space wrap size={6} style={{ marginBottom: 6 }}>
            {images.map((attachment) => (
              <Image
                key={attachment.id}
                src={`${API_URL}/workflow-chat/attachments/${attachment.id}`}
                alt={t('attachedImageAlt')}
                width={120}
                style={{ borderRadius: 6, border: '1px solid #f0f0f0' }}
              />
            ))}
          </Space>
        </Image.PreviewGroup>
      )}
      {files.length > 0 && (
        <Space wrap size={6} style={{ marginBottom: 6 }}>
          {files.map((attachment) => (
            <Tag key={attachment.id} icon={<FileTextOutlined />} style={{ margin: 0, padding: '4px 8px' }}>
              <a
                href={`${API_URL}/workflow-chat/attachments/${attachment.id}`}
                target="_blank"
                rel="noreferrer"
              >
                {attachment.name}
              </a>{' '}
              · {formatSize(attachment.size, t)}
            </Tag>
          ))}
        </Space>
      )}
    </>
  );
}
