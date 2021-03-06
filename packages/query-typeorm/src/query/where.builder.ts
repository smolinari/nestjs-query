import { Brackets, WhereExpression } from 'typeorm';
import { Filter, FilterComparisons, FilterFieldComparison } from '@nestjs-query/core';
import { EntityComparisonField, SQLComparisonBuilder } from './sql-comparison.builder';

/**
 * @internal
 * Builds a WHERE clause from a Filter.
 */
export class WhereBuilder<Entity> {
  constructor(readonly sqlComparisonBuilder: SQLComparisonBuilder<Entity> = new SQLComparisonBuilder<Entity>()) {}

  /**
   * Builds a WHERE clause from a Filter.
   * @param where - the `typeorm` WhereExpression
   * @param filter - the filter to build the WHERE clause from.
   * @param alias - optional alias to use to qualify an identifier
   */
  build<Where extends WhereExpression>(
    where: Where,
    filter: Filter<Entity>,
    relationNames: string[],
    alias?: string,
  ): Where {
    const { and, or } = filter;
    if (and && and.length) {
      this.filterAnd(where, and, relationNames, alias);
    }
    if (or && or.length) {
      this.filterOr(where, or, relationNames, alias);
    }
    return this.filterFields(where, filter, relationNames, alias);
  }

  /**
   * ANDs multiple filters together. This will properly group every clause to ensure proper precedence.
   *
   * @param where - the `typeorm` WhereExpression
   * @param filters - the array of filters to AND together
   * @param alias - optional alias to use to qualify an identifier
   */
  private filterAnd<Where extends WhereExpression>(
    where: Where,
    filters: Filter<Entity>[],
    relationNames: string[],
    alias?: string,
  ): Where {
    return where.andWhere(
      new Brackets((qb) => filters.reduce((w, f) => qb.andWhere(this.createBrackets(f, relationNames, alias)), qb)),
    );
  }

  /**
   * ORs multiple filters together. This will properly group every clause to ensure proper precedence.
   *
   * @param where - the `typeorm` WhereExpression
   * @param filter - the array of filters to OR together
   * @param alias - optional alias to use to qualify an identifier
   */
  private filterOr<Where extends WhereExpression>(
    where: Where,
    filter: Filter<Entity>[],
    relationNames: string[],
    alias?: string,
  ): Where {
    return where.andWhere(
      new Brackets((qb) => filter.reduce((w, f) => qb.orWhere(this.createBrackets(f, relationNames, alias)), qb)),
    );
  }

  /**
   * Wraps a filter in brackes to ensure precedence.
   * ```
   * {a: { eq: 1 } } // "(a = 1)"
   * {a: { eq: 1 }, b: { gt: 2 } } // "((a = 1) AND (b > 2))"
   * ```
   * @param filter - the filter to wrap in brackets.
   * @param alias - optional alias to use to qualify an identifier
   */
  private createBrackets(filter: Filter<Entity>, relationNames: string[], alias?: string): Brackets {
    return new Brackets((qb) => this.build(qb, filter, relationNames, alias));
  }

  /**
   * Creates field comparisons from a filter. This method will ignore and/or properties.
   * @param where - the `typeorm` WhereExpression
   * @param filter - the filter with fields to create comparisons for.
   * @param alias - optional alias to use to qualify an identifier
   */
  private filterFields<Where extends WhereExpression>(
    where: Where,
    filter: Filter<Entity>,
    relationNames: string[],
    alias?: string,
  ): Where {
    return Object.keys(filter).reduce((w, field) => {
      if (field !== 'and' && field !== 'or') {
        return this.withFilterComparison(
          where,
          field as keyof Entity,
          this.getField(filter, field as keyof Entity),
          relationNames,
          alias,
        );
      }
      return w;
    }, where);
  }

  private getField<K extends keyof FilterComparisons<Entity>>(
    obj: FilterComparisons<Entity>,
    field: K,
  ): FilterFieldComparison<Entity[K]> {
    return obj[field] as FilterFieldComparison<Entity[K]>;
  }

  private withFilterComparison<T extends keyof Entity, Where extends WhereExpression>(
    where: Where,
    field: T,
    cmp: FilterFieldComparison<Entity[T]>,
    relationNames: string[],
    alias?: string,
  ): Where {
    if (relationNames.includes(field as string)) {
      return this.withRelationFilter(where, field, cmp as Filter<Entity[T]>);
    }
    return where.andWhere(
      new Brackets((qb) => {
        const opts = Object.keys(cmp) as (keyof FilterFieldComparison<Entity[T]>)[];
        const sqlComparisons = opts.map((cmpType) =>
          this.sqlComparisonBuilder.build(field, cmpType, cmp[cmpType] as EntityComparisonField<Entity, T>, alias),
        );
        sqlComparisons.map(({ sql, params }) => qb.orWhere(sql, params));
      }),
    );
  }

  private withRelationFilter<T extends keyof Entity, Where extends WhereExpression>(
    where: Where,
    field: T,
    cmp: Filter<Entity[T]>,
  ): Where {
    return where.andWhere(
      new Brackets((qb) => {
        const relationWhere = new WhereBuilder<Entity[T]>();
        // for now ignore relations of relations.
        return relationWhere.build(qb, cmp, [], field as string);
      }),
    );
  }
}
