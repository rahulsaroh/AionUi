/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { Card, Button, Tag, Typography, Space, Timeline, Alert, Tooltip } from '@arco-design/web-react';
import { Play, Refresh, CheckOne, CloseOne, Time, LoadingOne, FileCode, ShareTwo, Right } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { IPipelineRun, IPipelineStep, PipelineStepStatus } from '@/common/types/pipeline/pipelineTypes';

const { Title, Text, Paragraph } = Typography;
const TimelineItem = Timeline.Item;

export interface RunTimelineProps {
  run: IPipelineRun;
  onResume?: (runId: string) => Promise<void> | void;
  onRerunStep?: (runId: string, stepIndex: number) => Promise<void> | void;
  className?: string;
}

export const RunTimeline: React.FC<RunTimelineProps> = ({ run, onResume, onRerunStep, className }) => {
  const { t } = useTranslation();
  const [resuming, setResuming] = useState(false);
  const [rerunningStepIndex, setRerunningStepIndex] = useState<number | null>(null);

  const completedCount = useMemo(
    () => run.steps.filter((s) => s.status === 'completed' || s.status === 'skipped').length,
    [run.steps]
  );

  const canResume = useMemo(() => {
    return (
      run.status === 'failed' ||
      run.status === 'pending' ||
      run.steps.some((s) => s.status === 'failed' || s.status === 'pending')
    );
  }, [run.status, run.steps]);

  const handleResume = async () => {
    if (!onResume || resuming) return;
    try {
      setResuming(true);
      await onResume(run.id);
    } finally {
      setResuming(false);
    }
  };

  const handleRerun = async (stepIndex: number) => {
    if (!onRerunStep || rerunningStepIndex !== null) return;
    try {
      setRerunningStepIndex(stepIndex);
      await onRerunStep(run.id, stepIndex);
    } finally {
      setRerunningStepIndex(null);
    }
  };

  const getStepStatusTag = (status: PipelineStepStatus) => {
    switch (status) {
      case 'completed':
        return (
          <Tag color='green' size='small' icon={<CheckOne />}>
            {t('pipeline.status.completed', { defaultValue: 'Completed' })}
          </Tag>
        );
      case 'running':
        return (
          <Tag color='arcoblue' size='small' icon={<LoadingOne className='animate-spin' />}>
            {t('pipeline.status.running', { defaultValue: 'Running' })}
          </Tag>
        );
      case 'failed':
        return (
          <Tag color='red' size='small' icon={<CloseOne />}>
            {t('pipeline.status.failed', { defaultValue: 'Failed' })}
          </Tag>
        );
      case 'skipped':
        return (
          <Tag color='cyan' size='small' icon={<Right />}>
            {t('pipeline.status.skipped', { defaultValue: 'Skipped' })}
          </Tag>
        );
      default:
        return (
          <Tag color='gray' size='small' icon={<Time />}>
            {t('pipeline.status.pending', { defaultValue: 'Pending' })}
          </Tag>
        );
    }
  };

  const getRunStatusColor = () => {
    switch (run.status) {
      case 'completed':
        return 'green';
      case 'running':
        return 'arcoblue';
      case 'failed':
        return 'red';
      default:
        return 'gray';
    }
  };

  return (
    <Card
      className={`border border-border-2 rd-12px bg-bg-2 shadow-sm ${className || ''}`}
      data-testid='pipeline-run-timeline'
    >
      {/* Header bar */}
      <div className='flex items-center justify-between pb-16px border-b border-border-1 mb-16px flex-wrap gap-12px'>
        <div>
          <div className='flex items-center gap-10px mb-4px'>
            <Title heading={5} className='m-0 text-t-primary font-bold'>
              {run.name}
            </Title>
            <Tag color={getRunStatusColor()} size='medium' className='font-semibold'>
              {run.status.toUpperCase()}
            </Tag>
          </div>
          <Text type='secondary' className='text-12px'>
            Run ID: <span className='font-mono'>{run.id}</span> | Project:{' '}
            <span className='font-mono'>{run.projectId}</span> | Progress: {completedCount}/{run.steps.length}
          </Text>
        </div>

        {/* Action Controls */}
        <Space size='medium'>
          <Button
            type='primary'
            status='default'
            icon={<Play />}
            disabled={!canResume}
            loading={resuming}
            onClick={handleResume}
            data-testid='btn-resume-run'
          >
            {t('pipeline.resume', { defaultValue: 'Resume' })}
          </Button>

          <Button
            type='outline'
            icon={<Refresh />}
            disabled={resuming || rerunningStepIndex !== null}
            onClick={() => handleRerun(0)}
            data-testid='btn-rerun-all'
          >
            {t('pipeline.rerunAll', { defaultValue: 'Re-run All' })}
          </Button>
        </Space>
      </div>

      {/* Steps Timeline */}
      <div className='pt-8px px-8px' data-testid='pipeline-steps-timeline'>
        <Timeline mode='left'>
          {run.steps.map((step) => {
            const isCurrentRerun = rerunningStepIndex === step.stepIndex;

            return (
              <TimelineItem
                key={step.id || step.stepIndex}
                label={<div className='text-12px text-t-secondary font-mono mr-12px'>#{step.stepIndex + 1}</div>}
                dotColor={
                  step.status === 'completed'
                    ? '#00b42a'
                    : step.status === 'running'
                      ? '#165dff'
                      : step.status === 'failed'
                        ? '#f53f3f'
                        : '#86909c'
                }
              >
                <div
                  className='p-12px rd-8px bg-fill-2 border border-border-2 mb-12px hover:border-border-3 transition-colors'
                  data-testid={`step-card-${step.stepIndex}`}
                >
                  <div className='flex items-center justify-between flex-wrap gap-8px mb-8px'>
                    <div className='flex items-center gap-8px'>
                      <Text
                        className='font-semibold text-14px text-t-primary'
                        data-testid={`step-name-${step.stepIndex}`}
                      >
                        {step.name}
                      </Text>
                      <span data-testid={`step-status-${step.stepIndex}`}>{getStepStatusTag(step.status)}</span>
                    </div>

                    <Space size='small'>
                      <Tooltip content={t('pipeline.rerunFromHere', { defaultValue: 'Re-run from this step' })}>
                        <Button
                          size='mini'
                          type='secondary'
                          icon={<Refresh />}
                          loading={isCurrentRerun}
                          onClick={() => handleRerun(step.stepIndex)}
                          data-testid={`btn-rerun-step-${step.stepIndex}`}
                        >
                          {t('pipeline.rerun', { defaultValue: 'Re-run' })}
                        </Button>
                      </Tooltip>
                    </Space>
                  </div>

                  {/* Artifacts and Content Hash */}
                  {step.artifactPaths && step.artifactPaths.length > 0 && (
                    <div
                      className='bg-fill-3 p-8px rd-6px mb-8px text-12px flex flex-col gap-4px'
                      data-testid={`step-artifacts-${step.stepIndex}`}
                    >
                      <div className='flex items-center gap-6px text-t-secondary font-semibold'>
                        <FileCode size='14' />
                        <span>{t('pipeline.artifacts', { defaultValue: 'Artifacts:' })}</span>
                      </div>
                      <div className='pl-20px font-mono text-11px text-t-secondary flex flex-col gap-2px'>
                        {step.artifactPaths.map((p, idx) => (
                          <div key={idx} className='truncate'>
                            • {p}
                          </div>
                        ))}
                      </div>

                      {step.contentHash && (
                        <div
                          className='mt-4px text-11px font-mono text-t-secondary flex items-center gap-4px'
                          data-testid={`step-hash-${step.stepIndex}`}
                        >
                          <span className='font-semibold'>SHA-256:</span>
                          <span className='truncate'>{step.contentHash}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Error display */}
                  {step.error && (
                    <Alert
                      type='error'
                      className='text-12px'
                      content={<span data-testid={`step-error-${step.stepIndex}`}>{step.error}</span>}
                    />
                  )}
                </div>
              </TimelineItem>
            );
          })}
        </Timeline>
      </div>
    </Card>
  );
};

export default RunTimeline;
