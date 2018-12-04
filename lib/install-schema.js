'use strict';

const ticketAuditLog = function (knex, table) {
  table.increments('audit_id').primary();
  table.string('tid').references('ticket_order.id');
  table.integer('item_id').references('ticket_items.item_id');
  table.string('made_by').notNullable();
  table.timestamp('created_at', true).notNullable().defaultTo(knex.fn.now());
  table.json('old_values', true).notNullable();
  table.json('new_values', true).notNullable();
};


module.exports = function (knex, Promise) {
  return Promise.all([
    knex.schema.createTable('accounts', function (table) {
      table.increments('id').notNullable().primary();
      table.string('service').notNullable();
      table.string('identifier').notNullable();
      table.string('external_id');
      table.string('role', true).notNullable().defaultTo('admin');
      table.timestamp('lastlogin', true);

      table.unique(['service', 'identifier']);
      table.unique(['service', 'external_id']);
    }),

    knex.schema.createTable('session', function (table) {
      table.string('sid').primary();
      table.json('sess').notNullable();
      table.timestamp('expire', true).notNullable();
    }),

    knex.schema.createTable('agenda', function (table) {
      table.increments('id').primary();
      table.boolean('published').notNullable().defaultTo(true).index();
      table.string('title').notNullable();
      table.time('start');
      table.time('stop');
      table.string('speaker');
      table.text('description');
      table.integer('category').notNullable().defaultTo(0);
      table.json('data', true);
      table.timestamp('created', true).notNullable().defaultTo(knex.raw('NOW()'));
      table.timestamp('modified', true).notNullable().defaultTo(knex.raw('NOW()'));
    }),

    knex.schema.createTable('speakers', function (table) {
      table.increments('id').primary();
      table.integer('page').notNullable().defaultTo(0);
      table.boolean('published').notNullable().defaultTo(true).index();
      table.string('name').notNullable();
      table.text('description');
      table.json('links');
      table.string('image');
      table.json('data', true);
      table.timestamp('created', true).notNullable().defaultTo(knex.raw('NOW()'));
      table.timestamp('modified', true).notNullable().defaultTo(knex.raw('NOW()'));
    }),

    knex.schema.createTable('vars', function (table) {
      table.string('key').notNullable();
      table.integer('page').notNullable().defaultTo(0);
      table.json('value').notNullable();
      table.timestamp('modified', true).notNullable().defaultTo(knex.raw('NOW()'));
      table.primary(['key', 'page']);
    }),

    knex.schema.createTable('speaker_agendas', function (table) {
      table.increments('id').notNullable().primary();
      table.integer('speaker').notNullable().index();
      table.integer('agenda').notNullable().index();

      table.unique(['speaker', 'agenda']);
    }),

    knex.schema.createTable('agenda_agendas', function (table) {
      table.increments('id').notNullable().primary();
      table.integer('agenda_from').notNullable().index();
      table.integer('agenda_to').notNullable().index();

      table.unique(['agenda_from', 'agenda_to']);
    }),


        knex.schema.createTable('ticket_order', function (table) {
          table.string('id', 10).primary();
          table.string('ticket_type', 40).notNullable();
          table.string('product_type', 40).notNullable();
          table.string('payment_type', 40).notNullable();
          table.string('email').notNullable();
          table.string('stripe_token');
          table.integer('ticket_price').notNullable();
          table.timestamp('removed_at', true);
          table.timestamp('sent_at', true);
          table.timestamp('paid_at', true);
          table.timestamp('created_at', true).notNullable().defaultTo(knex.fn.now());
        })
          .createTable('ticket_items', function (table) {
            table.string('tid').notNullable().references('ticket_order.id');
            table.increments('item_id').notNullable();
            table.json('ticket', true).notNullable();
          })
          .createTable('ticket_invoice', function (table) {
            table.increments('invoice_number').primary();
            table.string('tid').unique().notNullable().references('ticket_order.id');
            table.string('fortnox_id').unique();
            table.json('invoice', true).notNullable();
          })
          .createTable('ticket_audit_log', table => ticketAuditLog(knex, table))
  ]);
};
