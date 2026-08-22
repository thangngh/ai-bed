import { DataSource } from 'typeorm';
import { AdminFeedbackService } from '../admin-feedback.service';
import { Feedback } from '../../feedback/entities/feedback.entity';
import { ChildProfile } from '../../child/entities/child-profile.entity';
import { Story } from '../../story/entities/story.entity';
import { StorySection } from '../../story/entities/story-section.entity';
import { Tenant } from '../../tenant/entities/tenant.entity';
import { makeDataSource } from '../../../common/__tests__/test-db';

async function seed(core: DataSource, local: DataSource) {
  await core.getRepository(ChildProfile).save([
    Object.assign(new ChildProfile(), { childId: 'c1', tenantId: 't1', childName: 'Bống', age: 4, language: 'vi', isActive: 1 }),
  ]);
  await local.getRepository(Story).save([
    Object.assign(new Story(), { storyId: 's1', tenantId: 't1', title: 'Chú thỏ ngủ quên', content: '[]', theme: 'động vật', language: 'vi', safetyStatus: 'APPROVED', llmCalls: 0, retryCount: 0, isFallback: 0, isSaved: 0 }),
  ]);
  // Six rows across three days, one of them pointing at a story that does not
  // exist in local.db and has no child.
  const rows = [
    { feedbackId: 'f1', storyId: 's1', childId: 'c1', rating: 5, note: 'bé thích lắm',  createdAt: '2026-08-01 08:00:00' },
    { feedbackId: 'f2', storyId: 's1', childId: 'c1', rating: 3, note: null,            createdAt: '2026-08-02 08:00:00' },
    { feedbackId: 'f3', storyId: 's1', childId: 'c1', rating: 5, note: '',              createdAt: '2026-08-03 08:00:00' },
    { feedbackId: 'f4', storyId: 's1', childId: 'c1', rating: 1, note: 'dài quá',       createdAt: '2026-08-03 23:59:59' },
    { feedbackId: 'f5', storyId: 'gone', childId: null, rating: 4, note: 'ổn',          createdAt: '2026-08-04 08:00:00' },
    { feedbackId: 'f6', storyId: 's1', childId: 'c1', rating: 2, note: 'hơi buồn',      createdAt: '2026-08-05 08:00:00' },
  ];
  await core.getRepository(Feedback).save(
    rows.map((r) => Object.assign(new Feedback(), { tenantId: 't1', ...r })),
  );
}

describe('AdminFeedbackService.list', () => {
  let core: DataSource;
  let local: DataSource;
  let service: AdminFeedbackService;

  beforeEach(async () => {
    core = makeDataSource([Tenant, ChildProfile, Feedback]);
    local = makeDataSource([Story, StorySection]);
    await core.initialize();
    await local.initialize();
    await seed(core, local);
    service = new AdminFeedbackService(core, local);
  });

  afterEach(async () => { await core.destroy(); await local.destroy(); });

  it('returns newest first with total, limit and offset', async () => {
    const page = await service.list({});
    expect(page.total).toBe(6);
    expect(page.limit).toBe(20);
    expect(page.offset).toBe(0);
    expect(page.items.map((i) => i.feedback_id)).toEqual(['f6', 'f5', 'f4', 'f3', 'f2', 'f1']);
  });

  it('joins the child name and story title', async () => {
    const page = await service.list({});
    const f1 = page.items.find((i) => i.feedback_id === 'f1')!;
    expect(f1.child_name).toBe('Bống');
    expect(f1.story_title).toBe('Chú thỏ ngủ quên');
  });

  it('returns nulls rather than failing when the story or child is gone', async () => {
    const page = await service.list({});
    const f5 = page.items.find((i) => i.feedback_id === 'f5')!;
    expect(f5.story_title).toBeNull();
    expect(f5.child_name).toBeNull();
  });

  it('degrades a dangling childId to null child_name without failing', async () => {
    // f5 has no childId at all. Here a feedback points at a child that existed
    // when the feedback was written but whose profile has since been deleted.
    await core.getRepository(ChildProfile).delete({ childId: 'c1' });
    const page = await service.list({});
    const f1 = page.items.find((i) => i.feedback_id === 'f1')!;
    expect(f1.child_name).toBeNull();
    // The rest of the row still resolves normally.
    expect(f1.story_title).toBe('Chú thỏ ngủ quên');
  });

  it('filters by exact rating', async () => {
    const page = await service.list({ rating: 5 });
    expect(page.total).toBe(2);
    expect(page.items.map((i) => i.feedback_id).sort()).toEqual(['f1', 'f3']);
  });

  it('treats an empty-string note as no note for has_note', async () => {
    const withNote = await service.list({ has_note: 1 });
    expect(withNote.items.map((i) => i.feedback_id).sort()).toEqual(['f1', 'f4', 'f5', 'f6']);

    const withoutNote = await service.list({ has_note: 0 });
    expect(withoutNote.items.map((i) => i.feedback_id).sort()).toEqual(['f2', 'f3']);
  });

  it('filters by Vietnam calendar dates rather than UTC dates', async () => {
    const page = await service.list({ from: '2026-08-02', to: '2026-08-03' });
    // f4 is Aug 4 at 06:59:59 in Vietnam, so it is outside the selected range.
    expect(page.items.map((i) => i.feedback_id).sort()).toEqual(['f2', 'f3']);
  });

  it('combines filters', async () => {
    const page = await service.list({ rating: 5, from: '2026-08-03' });
    expect(page.items.map((i) => i.feedback_id)).toEqual(['f3']);
  });

  it('paginates without overlap and with a stable total', async () => {
    const first = await service.list({ limit: 2, offset: 0 });
    const second = await service.list({ limit: 2, offset: 2 });

    expect(first.total).toBe(6);
    expect(second.total).toBe(6);
    expect(first.items.map((i) => i.feedback_id)).toEqual(['f6', 'f5']);
    expect(second.items.map((i) => i.feedback_id)).toEqual(['f4', 'f3']);
  });

  it('clamps an oversized limit to 100 instead of rejecting it', async () => {
    const page = await service.list({ limit: 500 });
    expect(page.limit).toBe(100);
    expect(page.items).toHaveLength(6);
  });

  it('returns an empty page rather than an error when nothing matches', async () => {
    const page = await service.list({ rating: 5, from: '2026-09-01' });
    expect(page).toEqual({ items: [], total: 0, limit: 20, offset: 0 });
  });

  it('degrades to null titles when the local DB query fails', async () => {
    await local.destroy();
    const page = await service.list({});
    // Feedback lives in core.db; a broken local.db must not kill the page.
    expect(page.total).toBe(6);
    expect(page.items.every((i) => i.story_title === null)).toBe(true);
    local = makeDataSource([Story, StorySection]);
    await local.initialize();
  });
});
