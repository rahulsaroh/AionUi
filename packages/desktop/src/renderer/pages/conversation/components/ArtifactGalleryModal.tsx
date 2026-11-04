/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useMemo } from 'react';
import { Modal, Empty, Tag, Button, Spin, Typography, Message } from '@arco-design/web-react';
import { Copy, Download, Code, FileText } from '@icon-park/react';
import { ipcBridge } from '@/common';

type ArtifactItem = {
  id: string;
  name?: string;
  type?: string;
  content?: string;
  created_at?: number | string;
  metadata?: Record<string, unknown>;
};

interface ArtifactGalleryModalProps {
  visible: boolean;
  onClose: () => void;
  conversationId: string;
}

export const ArtifactGalleryModal: React.FC<ArtifactGalleryModalProps> = ({ visible, onClose, conversationId }) => {
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | 'code' | 'file' | 'markdown'>('all');

  useEffect(() => {
    if (!visible || !conversationId) return;

    let mounted = true;
    setLoading(true);

    (ipcBridge.conversation as any).listArtifacts
      ?.invoke?.({ conversation_id: conversationId })
      .then((data: unknown) => {
        if (!mounted) return;
        const list = Array.isArray(data) ? (data as ArtifactItem[]) : [];
        setArtifacts(list);
        if (list.length > 0) {
          setSelectedId(list[0].id);
        } else {
          setSelectedId(null);
        }
      })
      .catch(() => {
        if (mounted) {
          setArtifacts([]);
          setSelectedId(null);
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [visible, conversationId]);

  const filteredArtifacts = useMemo(() => {
    if (typeFilter === 'all') return artifacts;
    return artifacts.filter((item) => (item.type || '').toLowerCase() === typeFilter);
  }, [artifacts, typeFilter]);

  const currentArtifact = useMemo(() => {
    return artifacts.find((item) => item.id === selectedId) || filteredArtifacts[0] || null;
  }, [artifacts, filteredArtifacts, selectedId]);

  const handleCopyContent = () => {
    if (!currentArtifact) return;
    navigator.clipboard.writeText(currentArtifact.content || '');
    Message.success('Artifact content copied to clipboard');
  };

  const handleDownload = () => {
    if (!currentArtifact) return;
    const blob = new Blob([currentArtifact.content || ''], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = currentArtifact.name || `artifact-${currentArtifact.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    Message.success('Artifact downloaded');
  };

  return (
    <Modal
      title={
        <div className='flex items-center gap-8px'>
          <Typography.Title heading={6} className='!m-0'>
            Artifact Gallery
          </Typography.Title>
          <Tag size='small' color='arcoblue'>
            {filteredArtifacts.length} items
          </Tag>
        </div>
      }
      visible={visible}
      onOk={onClose}
      onCancel={onClose}
      footer={null}
      style={{ width: 840 }}
      className='artifact-gallery-modal'
    >
      <div className='flex items-center gap-8px mb-14px'>
        {(['all', 'code', 'markdown', 'file'] as const).map((filter) => (
          <Tag
            key={filter}
            className='cursor-pointer uppercase text-12px'
            color={typeFilter === filter ? 'arcoblue' : undefined}
            onClick={() => setTypeFilter(filter)}
          >
            {filter}
          </Tag>
        ))}
      </div>

      {loading ? (
        <div className='h-300px flex items-center justify-center'>
          <Spin dot />
        </div>
      ) : filteredArtifacts.length === 0 ? (
        <div className='py-60px flex flex-col items-center justify-center'>
          <Empty description='No generated artifacts found for this conversation' />
        </div>
      ) : (
        <div className='grid grid-cols-[260px_1fr] gap-16px h-450px'>
          <div className='overflow-y-auto border-r border-[var(--color-border-2)] pe-8px flex flex-col gap-6px'>
            {filteredArtifacts.map((art) => {
              const isSelected = currentArtifact?.id === art.id;
              return (
                <div
                  key={art.id}
                  onClick={() => setSelectedId(art.id)}
                  className={`p-10px rounded-8px cursor-pointer border transition-colors ${
                    isSelected
                      ? 'border-[var(--color-primary-light-3)] bg-[var(--color-primary-light-1)]'
                      : 'border-transparent hover:bg-[var(--fill-2)]'
                  }`}
                >
                  <div className='flex items-center gap-6px font-medium text-13px text-[var(--color-text-1)] truncate'>
                    {art.type === 'code' ? (
                      <Code theme='outline' size='14' className='text-arcoblue shrink-0' />
                    ) : (
                      <FileText theme='outline' size='14' className='text-arcoblue shrink-0' />
                    )}
                    <span className='truncate'>{art.name || 'Untitled Artifact'}</span>
                  </div>
                  <div className='flex items-center gap-6px mt-4px text-11px text-t-secondary'>
                    <Tag size='small'>{art.type || 'text'}</Tag>
                    <span>
                      {new Date(art.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className='flex flex-col h-full overflow-hidden'>
            {currentArtifact && (
              <>
                <div className='flex items-center justify-between pb-8px border-b border-[var(--color-border-2)] mb-8px'>
                  <div className='truncate max-w-[70%]'>
                    <Typography.Text bold className='text-14px'>
                      {currentArtifact.name || 'Artifact Details'}
                    </Typography.Text>
                  </div>
                  <div className='flex items-center gap-6px'>
                    <Button size='mini' icon={<Copy theme='outline' size='14' />} onClick={handleCopyContent}>
                      Copy
                    </Button>
                    <Button size='mini' icon={<Download theme='outline' size='14' />} onClick={handleDownload}>
                      Download
                    </Button>
                  </div>
                </div>
                <div className='flex-1 overflow-auto bg-[var(--color-fill-1)] p-12px rounded-6px border border-[var(--color-border-1)]'>
                  <pre className='m-0 font-mono text-12px whitespace-pre-wrap break-all text-[var(--color-text-1)]'>
                    {currentArtifact.content}
                  </pre>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
};
