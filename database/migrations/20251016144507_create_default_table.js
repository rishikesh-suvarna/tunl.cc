export async function up(knex) {
  return knex.schema
    .createTable('users', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('email', 255).unique().notNullable();
      table.string('name', 255);
      table.string('api_key', 64).unique().notNullable().index();
      table.integer('tunnel_limit').defaultTo(3);
      table.bigInteger('bandwidth_limit').defaultTo(1073741824); // 1GB
      table.boolean('is_active').defaultTo(true);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    })
    .createTable('tunnels', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('subdomain', 63).unique().notNullable().index();
      table
        .uuid('user_id')
        .references('id')
        .inTable('users')
        .onDelete('CASCADE');
      table.string('local_port', 10);
      table.string('ip_address', 45);
      table.boolean('is_active').defaultTo(true);
      table.bigInteger('requests_count').defaultTo(0);
      table.bigInteger('bytes_transferred').defaultTo(0);
      table.timestamp('connected_at').defaultTo(knex.fn.now());
      table.timestamp('last_activity_at').defaultTo(knex.fn.now());
      table.timestamp('disconnected_at');
      table.timestamp('created_at').defaultTo(knex.fn.now());

      table.index(['user_id', 'is_active']);
      table.index('connected_at');
    })
    .createTable('requests', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table
        .uuid('tunnel_id')
        .references('id')
        .inTable('tunnels')
        .onDelete('CASCADE');
      table.string('method', 10);
      table.text('path');
      table.integer('status_code');
      table.bigInteger('request_size').defaultTo(0);
      table.bigInteger('response_size').defaultTo(0);
      table.integer('duration_ms');
      table.string('user_agent', 500);
      table.string('ip_address', 45);
      table.timestamp('created_at').defaultTo(knex.fn.now());

      table.index(['tunnel_id', 'created_at']);
      table.index('created_at');
    });
}

export async function down(knex) {
  return knex.schema
    .dropTableIfExists('requests')
    .dropTableIfExists('tunnels')
    .dropTableIfExists('users');
}
