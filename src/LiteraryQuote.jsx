import React from 'react'
import './literaryQuote.css'

export default function LiteraryQuote({ quote, className = '' }) {
  return <figure className={`literary-quote ${className}`}>
    <blockquote cite={quote.source || undefined}><p className="lq-text">{quote.text}</p></blockquote>
    {(quote.author || quote.work) && <figcaption className="lq-credit">— <cite>
      {quote.source ? <a href={quote.source} target="_blank" rel="noopener noreferrer" title="查看引用出处">{quote.author}{quote.work && `《${quote.work}》`}</a>
        : <>{quote.author}{quote.work && `《${quote.work}》`}</>}
    </cite></figcaption>}
  </figure>
}
