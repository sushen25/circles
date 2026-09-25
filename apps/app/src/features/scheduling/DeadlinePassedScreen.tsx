import { Fragment } from 'react';

import {
  Body,
  BodyText,
  Button,
  Card,
  DisplayL,
  Foot,
  Icon,
  ListRow,
  Notice,
  Screen,
  Sheet,
  Small,
  Tertiary,
  Title,
  TopBar,
  usePalette,
} from '../../components';
import { Divider, Stack } from '../../components/layout';
import { t } from '../../copy';
import type { ExtensionView, HandOffRow } from './deadline';
import { CandidateCard, CandidateHeader, Placeholder } from './parts';
import type { CardView, HeaderView } from './view';

/**
 * DeadlinePassed — `docs/design/DeadlinePassed.dc.html` (spec §5.7, S2-05).
 *
 * Replies have closed and nothing is locked in. "Nobody wants to decide" is
 * the failure this screen is for, so it has one clear primary and two ways
 * out, and nothing else: **Lock in <day>** for the top option (or whichever
 * the organiser taps), **Hand this to someone else**, and **Give it one more
 * day** — which says until when, or, when it cannot be given, says why rather
 * than being a button that does nothing (ADR 0010).
 *
 * Presentational: every sentence arrives worked out (`deadline.ts`, `view.ts`)
 * and every decision about what is allowed is the domain's.
 */
export type DeadlinePassedState = 'default' | 'loading' | 'error' | 'offline' | 'denied';

export type DeadlinePassedProps = {
  state?: DeadlinePassedState | undefined;
  header?: HeaderView | undefined;
  headline?: string | undefined;
  lead?: string | undefined;
  cards?: readonly CardView[] | undefined;
  selectedId?: string | undefined;
  lockInLabel?: string | undefined;
  extension?: ExtensionView | undefined;
  /** What is on screen was worked out before the newest change. */
  stale?: boolean | undefined;
  busy?: 'extend' | 'hand_off' | undefined;
  problem?: string | undefined;
  /** Which sheet is open: choosing who, or confirming them. */
  sheet?: 'who' | 'confirm' | undefined;
  rows?: readonly HandOffRow[] | undefined;
  rowsState?: 'loading' | 'error' | 'ready' | undefined;
  targetName?: string | undefined;
  onSelect?: ((id: string) => void) | undefined;
  onLockIn?: (() => void) | undefined;
  onHandOff?: (() => void) | undefined;
  onExtend?: (() => void) | undefined;
  onChoose?: ((userId: string) => void) | undefined;
  onConfirmHandOff?: (() => void) | undefined;
  onBackToList?: (() => void) | undefined;
  onDismissSheet?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
};

export function DeadlinePassedScreen({
  state = 'default',
  header,
  headline,
  lead,
  cards = [],
  selectedId,
  lockInLabel,
  extension,
  stale = false,
  busy,
  problem,
  sheet,
  rows = [],
  rowsState = 'loading',
  targetName,
  onSelect,
  onLockIn,
  onHandOff,
  onExtend,
  onChoose,
  onConfirmHandOff,
  onBackToList,
  onDismissSheet,
  onRetry,
  onBack,
}: DeadlinePassedProps) {
  const palette = usePalette();

  if (state === 'loading') {
    return <Placeholder message={t('deadlinePassed', 'loading')} onBack={onBack} />;
  }
  if (state === 'error' || state === 'offline') {
    return (
      <Placeholder
        message={
          state === 'offline' ? t('candidates', 'youre_offline') : t('candidates', 'couldnt_load')
        }
        actionLabel={t('candidates', 'try_again')}
        onAction={onRetry}
        onBack={onBack}
      />
    );
  }
  if (state === 'denied') {
    return (
      <Placeholder
        message={t('candidates', 'denied_title')}
        detail={t('candidates', 'denied_body')}
        onBack={onBack}
      />
    );
  }

  const handOffTitle = t('deadlinePassed', 'hand_off_title');
  const handOffBody = t('deadlinePassed', 'hand_off_body');
  const acting = busy !== undefined || stale;
  const available = rows.filter((row) => row.available);
  const name = targetName ?? '';

  return (
    <Screen>
      <TopBar title={header?.title} onBack={onBack} backLabel={t('common', 'back')} />
      <Body>
        {header === undefined ? null : <CandidateHeader header={header} />}
        <Stack>
          {headline === undefined ? null : <DisplayL>{headline}</DisplayL>}
          {lead === undefined ? null : <BodyText>{lead}</BodyText>}
        </Stack>
        {stale ? <Notice icon="clock">{t('candidates', 'updating')}</Notice> : null}
        {cards.map((card) => (
          <CandidateCard
            key={card.id}
            card={card}
            highlighted={selectedId === undefined ? card.recommended : card.id === selectedId}
            selected={card.id === selectedId}
            onPress={onSelect === undefined ? undefined : () => onSelect(card.id)}
          />
        ))}
        <Card>
          <ListRow
            title={handOffTitle}
            detail={handOffBody}
            label={t('deadlinePassed', 'row_label', { title: handOffTitle, detail: handOffBody })}
            leading={<Icon name="people" size={22} color={palette.accent} />}
            disabled={acting}
            onPress={onHandOff}
          />
          {extension === undefined ? null : (
            <>
              <Divider />
              <ListRow
                title={busy === 'extend' ? t('deadlinePassed', 'extending') : extension.title}
                detail={extension.body}
                label={t('deadlinePassed', 'row_label', {
                  title: extension.title,
                  detail: extension.body,
                })}
                leading={<Icon name="clock" size={22} color={palette.accent} />}
                disabled={!extension.available || acting}
                onPress={onExtend}
              />
            </>
          )}
        </Card>
        {problem === undefined ? null : <Notice kind="warn">{problem}</Notice>}
      </Body>
      <Foot>
        {lockInLabel === undefined ? null : (
          <Button label={lockInLabel} onPress={onLockIn} disabled={acting} />
        )}
      </Foot>
      <Sheet
        visible={sheet === 'who'}
        onDismiss={() => onDismissSheet?.()}
        label={t('deadlinePassed', 'sheet_label')}
        dismissLabel={t('deadlinePassed', 'sheet_dismiss')}
      >
        <Stack>
          <Title>{t('deadlinePassed', 'sheet_title')}</Title>
          <Small>{t('deadlinePassed', 'sheet_body')}</Small>
        </Stack>
        {rowsState === 'loading' ? <Small>{t('deadlinePassed', 'loading_members')}</Small> : null}
        {rowsState === 'error' ? (
          <Notice kind="warn">{t('deadlinePassed', 'members_failed')}</Notice>
        ) : null}
        {rowsState === 'ready' && available.length === 0 ? (
          <Notice icon="people">{t('deadlinePassed', 'nobody')}</Notice>
        ) : null}
        {rowsState === 'ready' && rows.length > 0 ? (
          <Card>
            {rows.map((row, index) => (
              <Fragment key={row.userId}>
                {index === 0 ? null : <Divider />}
                <ListRow
                  title={row.name}
                  detail={row.detail}
                  label={
                    row.detail === undefined
                      ? row.name
                      : t('deadlinePassed', 'row_label', { title: row.name, detail: row.detail })
                  }
                  disabled={!row.available}
                  onPress={row.available ? () => onChoose?.(row.userId) : undefined}
                />
              </Fragment>
            ))}
          </Card>
        ) : null}
        <Tertiary label={t('deadlinePassed', 'sheet_dismiss')} onPress={onDismissSheet} />
      </Sheet>
      <Sheet
        visible={sheet === 'confirm'}
        onDismiss={() => onDismissSheet?.()}
        label={t('deadlinePassed', 'sheet_label')}
        dismissLabel={t('deadlinePassed', 'keep')}
      >
        <Stack>
          <Title>{t('deadlinePassed', 'confirm_title', { name })}</Title>
          <BodyText>{t('deadlinePassed', 'confirm_body', { name })}</BodyText>
        </Stack>
        <Button
          label={
            busy === 'hand_off'
              ? t('deadlinePassed', 'handing')
              : t('deadlinePassed', 'confirm', { name })
          }
          disabled={busy === 'hand_off'}
          onPress={onConfirmHandOff}
        />
        <Tertiary label={t('deadlinePassed', 'back_to_list')} onPress={onBackToList} />
        <Tertiary label={t('deadlinePassed', 'keep')} onPress={onDismissSheet} />
      </Sheet>
    </Screen>
  );
}
