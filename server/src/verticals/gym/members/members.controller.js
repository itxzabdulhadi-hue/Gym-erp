import ApiError from '../../../utils/ApiError.js';
import * as members from './members.service.js';

/**
 * Members - HTTP layer.
 *
 * Reads the validated request, calls the service, and decides the status code
 * and content type. No SQL, no business rules.
 */

const actorOf = (req) => ({ userId: req.userId, userLabel: req.ctx.user.fullName });

const csvDownload = (res, filename, body) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(body);
};

export const membersController = {
  async list(req, res) {
    res.json(await members.listMembers(req.tenantId, req.validatedQuery));
  },

  importTemplate(_req, res) {
    csvDownload(res, 'members-import-template.csv', members.importTemplateCsv());
  },

  async export(req, res) {
    csvDownload(res, 'members.csv', await members.exportMembersCsv(req.tenantId, req.validatedQuery));
  },

  async import(req, res) {
    if (!req.file) throw ApiError.badRequest('Upload a CSV file in the "file" field');
    const result = await members.importMembers(req.tenantId, req.file.buffer.toString('utf8'), actorOf(req));
    res.status(result.imported ? 201 : 422).json({ data: result });
  },

  async bulkStatus(req, res) {
    res.json(await members.bulkUpdateStatus(req.tenantId, req.body.ids, req.body.status, actorOf(req)));
  },

  async create(req, res) {
    res.status(201).json({ data: await members.createMember(req.tenantId, req.body, actorOf(req)) });
  },

  async read(req, res) {
    res.json({ data: await members.getMember(req.tenantId, req.validatedParams.id) });
  },

  async update(req, res) {
    res.json({ data: await members.updateMember(req.tenantId, req.validatedParams.id, req.body, actorOf(req)) });
  },

  async remove(req, res) {
    res.json(await members.deleteMember(req.tenantId, req.validatedParams.id, actorOf(req)));
  },

  async memberships(req, res) {
    res.json({ data: await members.memberMemberships(req.tenantId, req.validatedParams.id) });
  },

  async payments(req, res) {
    res.json({ data: await members.memberPayments(req.tenantId, req.validatedParams.id, req.query.limit) });
  },

  async attendance(req, res) {
    res.json({
      data: await members.memberAttendance(req.tenantId, req.validatedParams.id, {
        limit: req.query.limit,
        from: req.query.from,
        to: req.query.to,
      }),
    });
  },

  async progress(req, res) {
    res.json({ data: await members.memberProgress(req.tenantId, req.validatedParams.id) });
  },

  async workouts(req, res) {
    res.json({ data: await members.memberWorkouts(req.tenantId, req.validatedParams.id) });
  },

  async documents(req, res) {
    res.json({ data: await members.memberDocuments(req.tenantId, req.validatedParams.id) });
  },

  async attachDocument(req, res) {
    res.status(201).json({ data: await members.attachDocument(req.tenantId, req.validatedParams.id, req.body, actorOf(req)) });
  },
};

export default membersController;
