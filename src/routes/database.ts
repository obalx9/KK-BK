import { Router, Request, Response } from 'express';
import pool from '../db';
import { authenticateToken } from '../auth';

const router = Router();

interface QueryFilter {
  column: string;
  operator: string;
  value: string;
}

router.get('/public/:table', async (req: Request, res: Response) => {
  const { table } = req.params;
  const { select = '*', order, limit, offset } = req.query as Record<string, string>;

  const PUBLIC_TABLES = ['featured_courses', 'ad_posts'];

  if (!PUBLIC_TABLES.includes(table)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const filters = parseFilters(req.query as Record<string, string>);
    const { sql: whereClause, params } = buildWhereClause(filters);

    let query = `SELECT ${select} FROM ${table} ${whereClause}`;

    if (order) {
      const [column, direction] = order.split('.');
      query += ` ORDER BY ${column} ${direction?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'}`;
    }

    if (limit) {
      query += ` LIMIT ${parseInt(limit, 10)}`;
    }

    if (offset) {
      query += ` OFFSET ${parseInt(offset, 10)}`;
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Database SELECT error:', error);
    res.status(500).json({ error: 'Database query failed' });
  }
});

function parseFilters(query: Record<string, string>): QueryFilter[] {
  const filters: QueryFilter[] = [];

  Object.keys(query).forEach(key => {
    if (key === 'select' || key === 'order' || key === 'limit' || key === 'offset') {
      return;
    }

    const parts = key.split('.');
    if (parts.length === 2) {
      filters.push({
        column: parts[0],
        operator: parts[1],
        value: query[key]
      });
    }
  });

  return filters;
}

function buildWhereClause(filters: QueryFilter[]): { sql: string; params: unknown[] } {
  if (filters.length === 0) {
    return { sql: '', params: [] };
  }

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  filters.forEach(filter => {
    const { column, operator, value } = filter;

    switch (operator) {
      case 'eq':
        conditions.push(`${column} = $${paramIndex}`);
        params.push(value === 'null' ? null : value);
        paramIndex++;
        break;
      case 'neq':
        conditions.push(`${column} != $${paramIndex}`);
        params.push(value === 'null' ? null : value);
        paramIndex++;
        break;
      case 'gt':
        conditions.push(`${column} > $${paramIndex}`);
        params.push(value);
        paramIndex++;
        break;
      case 'gte':
        conditions.push(`${column} >= $${paramIndex}`);
        params.push(value);
        paramIndex++;
        break;
      case 'lt':
        conditions.push(`${column} < $${paramIndex}`);
        params.push(value);
        paramIndex++;
        break;
      case 'lte':
        conditions.push(`${column} <= $${paramIndex}`);
        params.push(value);
        paramIndex++;
        break;
      case 'like':
        conditions.push(`${column} LIKE $${paramIndex}`);
        params.push(value);
        paramIndex++;
        break;
      case 'ilike':
        conditions.push(`${column} ILIKE $${paramIndex}`);
        params.push(value);
        paramIndex++;
        break;
      case 'is':
        if (value === 'null') {
          conditions.push(`${column} IS NULL`);
        } else {
          conditions.push(`${column} IS $${paramIndex}`);
          params.push(value);
          paramIndex++;
        }
        break;
      case 'in':
        try {
          const values = JSON.parse(value);
          const placeholders = values.map((_: unknown, i: number) => `$${paramIndex + i}`).join(',');
          conditions.push(`${column} IN (${placeholders})`);
          params.push(...values);
          paramIndex += values.length;
        } catch (e) {
          console.error('Error parsing IN values:', e);
        }
        break;
    }
  });

  return {
    sql: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params
  };
}

router.get('/:table', authenticateToken, async (req: Request, res: Response) => {
  const { table } = req.params;
  const { select = '*', order, limit, offset } = req.query as Record<string, string>;

  try {
    const filters = parseFilters(req.query as Record<string, string>);
    const { sql: whereClause, params } = buildWhereClause(filters);

    let query = `SELECT ${select} FROM ${table} ${whereClause}`;

    if (order) {
      const [column, direction] = order.split('.');
      query += ` ORDER BY ${column} ${direction?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'}`;
    }

    if (limit) {
      query += ` LIMIT ${parseInt(limit, 10)}`;
    }

    if (offset) {
      query += ` OFFSET ${parseInt(offset, 10)}`;
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Database SELECT error:', error);
    res.status(500).json({ error: 'Database query failed' });
  }
});

router.post('/:table', authenticateToken, async (req: Request, res: Response) => {
  const { table } = req.params;
  const data = req.body;

  try {
    const isArray = Array.isArray(data);
    const records = isArray ? data : [data];

    if (records.length === 0) {
      return res.json([]);
    }

    const columns = Object.keys(records[0]);
    const columnsList = columns.join(', ');

    const values: unknown[] = [];
    const valuePlaceholders: string[] = [];

    records.forEach((record, recordIndex) => {
      const recordPlaceholders = columns.map((_, colIndex) => {
        return `$${recordIndex * columns.length + colIndex + 1}`;
      });
      valuePlaceholders.push(`(${recordPlaceholders.join(', ')})`);

      columns.forEach(col => {
        values.push(record[col]);
      });
    });

    const query = `
      INSERT INTO ${table} (${columnsList})
      VALUES ${valuePlaceholders.join(', ')}
      RETURNING *
    `;

    const result = await pool.query(query, values);
    res.json(isArray ? result.rows : result.rows[0]);
  } catch (error) {
    console.error('Database INSERT error:', error);
    res.status(500).json({ error: 'Database insert failed' });
  }
});

router.patch('/:table', authenticateToken, async (req: Request, res: Response) => {
  const { table } = req.params;
  const data = req.body;

  try {
    const filters = parseFilters(req.query as Record<string, string>);
    const { sql: whereClause, params: whereParams } = buildWhereClause(filters);

    if (!whereClause) {
      return res.status(400).json({ error: 'UPDATE requires WHERE clause' });
    }

    const columns = Object.keys(data);
    const setClause = columns.map((col, idx) => `${col} = $${idx + 1}`).join(', ');
    const values = columns.map(col => data[col]);

    const query = `
      UPDATE ${table}
      SET ${setClause}
      ${whereClause.replace(/\$(\d+)/g, (_, num) => `$${parseInt(num) + columns.length}`)}
      RETURNING *
    `;

    const result = await pool.query(query, [...values, ...whereParams]);
    res.json(result.rows[0] || null);
  } catch (error) {
    console.error('Database UPDATE error:', error);
    res.status(500).json({ error: 'Database update failed' });
  }
});

router.delete('/:table', authenticateToken, async (req: Request, res: Response) => {
  const { table } = req.params;

  try {
    const filters = parseFilters(req.query as Record<string, string>);
    const { sql: whereClause, params } = buildWhereClause(filters);

    if (!whereClause) {
      return res.status(400).json({ error: 'DELETE requires WHERE clause' });
    }

    const query = `DELETE FROM ${table} ${whereClause} RETURNING *`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Database DELETE error:', error);
    res.status(500).json({ error: 'Database delete failed' });
  }
});

router.post('/:table/upsert', authenticateToken, async (req: Request, res: Response) => {
  const { table } = req.params;
  const data = req.body;

  try {
    const isArray = Array.isArray(data);
    const records = isArray ? data : [data];

    if (records.length === 0) {
      return res.json([]);
    }

    const columns = Object.keys(records[0]);
    const columnsList = columns.join(', ');

    const values: unknown[] = [];
    const valuePlaceholders: string[] = [];

    records.forEach((record, recordIndex) => {
      const recordPlaceholders = columns.map((_, colIndex) => {
        return `$${recordIndex * columns.length + colIndex + 1}`;
      });
      valuePlaceholders.push(`(${recordPlaceholders.join(', ')})`);

      columns.forEach(col => {
        values.push(record[col]);
      });
    });

    const updateColumns = columns.filter(col => col !== 'id');
    const updateSet = updateColumns.map(col => `${col} = EXCLUDED.${col}`).join(', ');

    const query = `
      INSERT INTO ${table} (${columnsList})
      VALUES ${valuePlaceholders.join(', ')}
      ON CONFLICT (id) DO UPDATE SET ${updateSet}
      RETURNING *
    `;

    const result = await pool.query(query, values);
    res.json(isArray ? result.rows : result.rows[0]);
  } catch (error) {
    console.error('Database UPSERT error:', error);
    res.status(500).json({ error: 'Database upsert failed' });
  }
});

export default router;
