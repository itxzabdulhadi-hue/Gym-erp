import { http } from '@/lib/apiClient';

export const workoutsApi = {
  exercises: {
    list: (params) => http.get('/workouts/exercises', { query: params }),
    get: (id) => http.get(`/workouts/exercises/${id}`),
    create: (body) => http.post('/workouts/exercises', body),
    update: (id, patch) => http.patch(`/workouts/exercises/${id}`, patch),
    remove: (id) => http.delete(`/workouts/exercises/${id}`),
  },
  plans: {
    list: (params) => http.get('/workouts/plans', { query: params }),
    get: (id) => http.get(`/workouts/plans/${id}`),
    create: (body) => http.post('/workouts/plans', body),
    update: (id, patch) => http.patch(`/workouts/plans/${id}`, patch),
    remove: (id) => http.delete(`/workouts/plans/${id}`),
    duplicate: (id) => http.post(`/workouts/plans/${id}/duplicate`, {}),
    assign: (id, body) => http.post(`/workouts/plans/${id}/assign`, body),
  },
  assignments: {
    list: (params) => http.get('/workouts/assignments', { query: params }),
    get: (id) => http.get(`/workouts/assignments/${id}`),
    update: (id, patch) => http.patch(`/workouts/assignments/${id}`, patch),
    remove: (id) => http.delete(`/workouts/assignments/${id}`),
  },
  logs: {
    list: (params) => http.get('/workouts/logs', { query: params }),
    create: (body) => http.post('/workouts/logs', body),
  },
};

export default workoutsApi;
